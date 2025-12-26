import { createNoise2D } from 'simplex-noise';

// --- CONFIGURATION ---
const TILE_WIDTH = 64;   // Width of the tile in pixels
const TILE_HEIGHT = 32;  // Height (usually half width for standard ISO)
const GRID_SIZE = 30;    // Size of the data grid (30x30)

const noise2D = createNoise2D();

// --- TYPES ---
enum TerrainType {
    Water = 0,
    Sand = 1,
    Dirt = 2,
    Grass = 3
}

enum RenderMode {
    IsometricTextured = 0,
    IsometricColored = 1,
    OrthographicColored = 2
}

interface WangTileMember {
    id: number;
    role: number;
}

interface WangTileData {
    tile_width: number;
    tile_height: number;
    wang_sets: Array<{ members: WangTileMember[] }>;
}

interface TerrainAssets {
    image: HTMLImageElement;
    wangData: WangTileData;
    roleToId: Map<number, number>;
}

const terrainAssets: Map<TerrainType, TerrainAssets> = new Map();
let assetsLoaded = false;

// --- ASSET LOADING FUNCTIONS ---
async function loadTerrainAssets(): Promise<void> {
    console.log("Starting to load terrain assets...");
    const terrainNames = ['water', 'sand', 'dirt', 'grass'];
    const promises = terrainNames.map(async (name, index) => {
        console.log(`Loading ${name}...`);

        // Load image
        const img = new Image();
        const imgPromise = new Promise<void>((resolve, reject) => {
            img.onload = () => {
                console.log(`${name}.png loaded successfully`);
                resolve();
            };
            img.onerror = (e) => {
                console.error(`Failed to load ${name}.png:`, e);
                reject(e);
            };
            img.src = `/${name}/${name}.png`;
        });

        // Load wang data
        const response = await fetch(`/${name}/${name}.txt`);
        const wangData: WangTileData = await response.json();
        console.log(`${name}.txt loaded:`, wangData);

        await imgPromise;

        // Build role-to-id lookup map
        const roleToId = new Map<number, number>();
        if (wangData.wang_sets && wangData.wang_sets[0]) {
            wangData.wang_sets[0].members.forEach(member => {
                roleToId.set(member.role, member.id);
            });
        }

        terrainAssets.set(index as TerrainType, {
            image: img,
            wangData,
            roleToId
        });

        console.log(`${name} assets stored at index ${index}`);
    });

    await Promise.all(promises);
    assetsLoaded = true;
    console.log("All assets loaded! assetsLoaded =", assetsLoaded);
}

// --- DUAL GRID SYSTEM ---
class DualGridSystem {
    public width: number;
    public height: number;
    public cells: TerrainType[];
    public renderMode: RenderMode = RenderMode.IsometricTextured;
    public cameraOffsetX: number = 0;
    public cameraOffsetY: number = 0;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.cells = new Array(width * height).fill(TerrainType.Water);
    }

    public getCell(x: number, y: number): TerrainType {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return TerrainType.Water;
        return this.cells[y * this.width + x];
    }

    public setCell(x: number, y: number, type: TerrainType) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.cells[y * this.width + x] = type;
        }
    }

    public generatePerlinMap() {
        // Scale affects the "zoom" of the noise. Lower = larger continents.
        const scale = 0.08;
        const seed = Math.random() * 1000;

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                // Get noise value between -1 and 1
                const value = noise2D((x + seed) * scale, (y + seed) * scale);

                // Map noise to Terrain
                let type = TerrainType.Water;
                if (value > -0.2) type = TerrainType.Sand;
                if (value > 0.0) type = TerrainType.Dirt;
                if (value > 0.3) type = TerrainType.Grass;

                this.setCell(x, y, type);
            }
        }
    }

    public render(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) {
        if (!assetsLoaded) return; // Wait for assets to load

        // Center the isometric map in the canvas with camera offset
        const originX = canvasWidth / 2 + this.cameraOffsetX;
        const originY = canvasHeight / 2 + this.cameraOffsetY;

        // Draw in layers: Water -> Sand -> Dirt -> Grass
        // This ensures proper visual stacking
        const layerOrder = [TerrainType.Water, TerrainType.Sand, TerrainType.Dirt, TerrainType.Grass];

        for (const terrainLayer of layerOrder) {
            for (let y = 0; y < this.height - 1; y++) {
                for (let x = 0; x < this.width - 1; x++) {

                    // 1. Get Neighbors (Dual Grid Logic)
                    const tl = this.getCell(x, y);
                    const tr = this.getCell(x + 1, y);
                    const bl = this.getCell(x, y + 1);
                    const br = this.getCell(x + 1, y + 1);

                    // Skip if none of the corners match this layer
                    if (tl !== terrainLayer && tr !== terrainLayer &&
                        bl !== terrainLayer && br !== terrainLayer) {
                        continue;
                    }

                    // 2. Calculate Position
                    let drawX, drawY;

                    if (this.renderMode === RenderMode.OrthographicColored) {
                        // Standard Top-Down with camera offset
                        drawX = originX + x * 40; // 40px square size for top-down debug
                        drawY = originY + y * 40;
                    } else {
                        // Isometric Projection Formula (for both textured and colored)
                        // x * 0.5 * width  +  y * -0.5 * width
                        drawX = originX + (x - y) * (TILE_WIDTH / 2);
                        drawY = originY + (x + y) * (TILE_HEIGHT / 2);
                    }

                    // 3. Draw Tile (Sprite or Procedural)
                    this.drawTile(ctx, drawX, drawY, tl, tr, bl, br, terrainLayer);
                }
            }
        }
    }

    private drawTile(
        ctx: CanvasRenderingContext2D,
        x: number, y: number,
        tl: TerrainType, tr: TerrainType, bl: TerrainType, br: TerrainType,
        terrainLayer: TerrainType
    ) {
        // Calculate Wang tile role based on which corners match this terrain layer
        // Wang tile bitmask: TL=1, TR=2, BL=4, BR=8
        let role = 0;
        if (tl === terrainLayer) role |= 1;
        if (tr === terrainLayer) role |= 2;
        if (bl === terrainLayer) role |= 4;
        if (br === terrainLayer) role |= 8;

        // Skip if role is 0 (no corners match)
        if (role === 0) return;

        const colors = {
            [TerrainType.Water]: '#225588',
            [TerrainType.Sand]:  '#eebb44',
            [TerrainType.Dirt]:  '#885533',
            [TerrainType.Grass]: '#44aa44'
        };

        if (this.renderMode === RenderMode.IsometricTextured) {
            // Textured Isometric Mode
            const assets = terrainAssets.get(terrainLayer);
            if (!assets) return;

            // Get the tile ID from the wang data
            const tileId = assets.roleToId.get(role);
            if (tileId === undefined) return;

            // Draw the sprite from the atlas
            // Tiles are arranged horizontally in the sprite sheet
            const srcX = tileId * TILE_WIDTH;
            const srcY = 0;

            // Center the tile on the draw position
            ctx.drawImage(
                assets.image,
                srcX, srcY, TILE_WIDTH, TILE_HEIGHT,
                x - TILE_WIDTH / 2, y - TILE_HEIGHT / 2,
                TILE_WIDTH, TILE_HEIGHT
            );

        } else if (this.renderMode === RenderMode.IsometricColored) {
            // Colored Isometric Mode - draw a diamond with solid color
            ctx.fillStyle = colors[terrainLayer];
            ctx.beginPath();
            ctx.moveTo(x, y - TILE_HEIGHT / 2);  // Top
            ctx.lineTo(x + TILE_WIDTH / 2, y);   // Right
            ctx.lineTo(x, y + TILE_HEIGHT / 2);  // Bottom
            ctx.lineTo(x - TILE_WIDTH / 2, y);   // Left
            ctx.closePath();
            ctx.fill();

        } else {
            // Orthographic Colored Mode - draw 4 quadrants
            const size = 40;
            const half = size / 2;

            if (tl === terrainLayer) {
                ctx.fillStyle = colors[tl];
                ctx.fillRect(x, y, half, half);
            }
            if (tr === terrainLayer) {
                ctx.fillStyle = colors[tr];
                ctx.fillRect(x + half, y, half, half);
            }
            if (bl === terrainLayer) {
                ctx.fillStyle = colors[bl];
                ctx.fillRect(x, y + half, half, half);
            }
            if (br === terrainLayer) {
                ctx.fillStyle = colors[br];
                ctx.fillRect(x + half, y + half, half, half);
            }
        }
    }
}

// --- APP SETUP ---

const canvas = document.getElementById('gridCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// Size canvas to fill available space (window height minus controls)
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

resizeCanvas();

const grid = new DualGridSystem(GRID_SIZE, GRID_SIZE);
grid.generatePerlinMap();

// --- LOOP ---
function loop() {
    // Background
    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (assetsLoaded) {
        grid.render(ctx, canvas.width, canvas.height);
    } else {
        // Show loading message
        ctx.fillStyle = "#eee";
        ctx.font = "20px 'Segoe UI'";
        ctx.textAlign = "center";
        ctx.fillText("Loading textures...", canvas.width / 2, canvas.height / 2);
    }

    requestAnimationFrame(loop);
}

// Start loading assets and begin render loop
loadTerrainAssets().then(() => {
    console.log("All terrain assets loaded!");
}).catch(err => {
    console.error("Failed to load assets:", err);
});

loop();

// --- EXPOSED FUNCTIONS FOR UI ---
// Use event listeners instead of inline onclick
document.getElementById('btnRegenerate')!.addEventListener('click', () => {
    console.log("Regenerating map...");
    grid.generatePerlinMap();
});

const btnToggleIso = document.getElementById('btnToggleIso')!;

function updateButtonText() {
    const modeNames = ['Isometric Textured', 'Isometric Colored', 'Orthographic Colored'];
    btnToggleIso.textContent = modeNames[grid.renderMode];
}

btnToggleIso.addEventListener('click', () => {
    console.log("Cycling render mode...");
    grid.renderMode = (grid.renderMode + 1) % 3;
    updateButtonText();
});

// Set initial button text
updateButtonText();

// Handle resize
window.addEventListener('resize', () => {
    resizeCanvas();
});

// --- CAMERA PANNING ---
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;

    grid.cameraOffsetX += deltaX;
    grid.cameraOffsetY += deltaY;

    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
});

canvas.addEventListener('mouseup', () => {
    isDragging = false;
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
});
