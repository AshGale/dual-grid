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

// --- DEBUG SYSTEM ---
interface TileDebugInfo {
    gridX: number;
    gridY: number;
    corners: {
        tl: TerrainType;
        tr: TerrainType;
        bl: TerrainType;
        br: TerrainType;
    };
    baseLayer: {
        terrain: TerrainType;
        role: number;
        tileId?: number;
    };
    transitionLayers: Array<{
        terrain: TerrainType;
        role: number;
        tileId?: number;
        drawn: boolean;
        reason: string;
    }>;
}

let debugMode = false;
let selectedTileDebugInfo: TileDebugInfo | null = null;

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
    public showBaseLayer: boolean = true;
    public showTransitionLayer: boolean = true;
    public showWorldGrid: boolean = false;
    public showDualGrid: boolean = false;
    private debugTileX: number = -1;
    private debugTileY: number = -1;

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

    public setDebugTile(x: number, y: number) {
        this.debugTileX = x;
        this.debugTileY = y;
    }

    public getDebugInfo(x: number, y: number): TileDebugInfo | null {
        if (x < 0 || x >= this.width - 1 || y < 0 || y >= this.height - 1) {
            return null;
        }

        const tl = this.getCell(x, y);
        const tr = this.getCell(x + 1, y);
        const bl = this.getCell(x, y + 1);
        const br = this.getCell(x + 1, y + 1);

        const debugInfo: TileDebugInfo = {
            gridX: x,
            gridY: y,
            corners: { tl, tr, bl, br },
            baseLayer: {
                terrain: Math.min(tl, tr, bl, br),
                role: 15,
                tileId: undefined
            },
            transitionLayers: []
        };

        // Get base layer tile ID
        const baseAssets = terrainAssets.get(debugInfo.baseLayer.terrain);
        if (baseAssets) {
            debugInfo.baseLayer.tileId = baseAssets.roleToId.get(15);
        }

        // Calculate transition layers
        const layerOrder = [TerrainType.Sand, TerrainType.Dirt, TerrainType.Grass];
        for (const currentLayer of layerOrder) {
            let role = 0;
            if (tl >= currentLayer) role |= 1;
            if (tr >= currentLayer) role |= 2;
            if (bl >= currentLayer) role |= 4;
            if (br >= currentLayer) role |= 8;

            let drawn = false;
            let reason = '';
            let tileId: number | undefined = undefined;

            if (role === 0) {
                reason = 'Skipped: No corners at this priority level';
            } else if (role === 15) {
                reason = 'Skipped: Full tile (already in base layer)';
            } else {
                drawn = true;
                reason = 'Drawn: Partial transition tile';
                const assets = terrainAssets.get(currentLayer);
                if (assets) {
                    tileId = assets.roleToId.get(role);
                }
            }

            debugInfo.transitionLayers.push({
                terrain: currentLayer,
                role,
                tileId,
                drawn,
                reason
            });
        }

        return debugInfo;
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

        // TWO-PASS RENDERING SYSTEM:
        // Pass 1: Base layer - draw full tiles (role 15 = all 4 corners match)
        // Pass 2: Transition layer - draw edge/corner tiles (role != 15)

        // PASS 1: BASE FULL TILES
        // For base layer, we need to ensure EVERY tile has a background
        // Strategy: Draw the lowest terrain type from the 4 corners as the base
        if (this.showBaseLayer) {
            for (let y = 0; y < this.height - 1; y++) {
                for (let x = 0; x < this.width - 1; x++) {
                    // Get the 4 corner cells
                    const tl = this.getCell(x, y);
                    const tr = this.getCell(x + 1, y);
                    const bl = this.getCell(x, y + 1);
                    const br = this.getCell(x + 1, y + 1);

                    // Find the lowest terrain type among the 4 corners
                    // (Water=0 is lowest, Grass=3 is highest)
                    const minTerrain = Math.min(tl, tr, bl, br);

                    // Draw a full tile of the lowest terrain type as the base
                    const { drawX, drawY } = this.calculateTilePosition(x, y, originX, originY);
                    this.drawTileByRole(ctx, drawX, drawY, minTerrain, 15);
                }
            }
        }

        // PASS 2: TRANSITION TILES - MULTI-PASS SPLATTING
        // Draw layers in priority order (Sand → Dirt → Grass)
        // Each layer "splats" onto lower layers, creating natural coastlines
        // Skip Water (0) since it's already the base layer
        if (this.showTransitionLayer) {
            const layerOrder = [TerrainType.Sand, TerrainType.Dirt, TerrainType.Grass];

            for (const currentLayer of layerOrder) {
                for (let y = 0; y < this.height - 1; y++) {
                    for (let x = 0; x < this.width - 1; x++) {
                        const tl = this.getCell(x, y);
                        const tr = this.getCell(x + 1, y);
                        const bl = this.getCell(x, y + 1);
                        const br = this.getCell(x + 1, y + 1);

                        // Calculate bitmask using >= comparison
                        // Any terrain at or above current layer priority is treated as 1
                        // Any terrain below current layer is treated as 0
                        let role = 0;
                        if (tl >= currentLayer) role |= 1;  // TL
                        if (tr >= currentLayer) role |= 2;  // TR
                        if (bl >= currentLayer) role |= 4;  // BL
                        if (br >= currentLayer) role |= 8;  // BR

                        // Skip if role is 0 (no corners at this priority) or 15 (full tile, already in base)
                        if (role === 0 || role === 15) continue;

                        const { drawX, drawY } = this.calculateTilePosition(x, y, originX, originY);
                        this.drawTileByRole(ctx, drawX, drawY, currentLayer, role);
                    }
                }
            }
        }

        // DEBUG OVERLAYS - World Grid (shows cell boundaries)
        if (this.showWorldGrid) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;

            if (this.renderMode === RenderMode.OrthographicColored) {
                // Orthographic grid
                for (let y = 0; y <= this.height; y++) {
                    for (let x = 0; x <= this.width; x++) {
                        const drawX = originX + x * 40;
                        const drawY = originY + y * 40;
                        if (x < this.width) {
                            ctx.beginPath();
                            ctx.moveTo(drawX, drawY);
                            ctx.lineTo(drawX + 40, drawY);
                            ctx.stroke();
                        }
                        if (y < this.height) {
                            ctx.beginPath();
                            ctx.moveTo(drawX, drawY);
                            ctx.lineTo(drawX, drawY + 40);
                            ctx.stroke();
                        }
                    }
                }
            } else {
                // Isometric grid - draw diamond shapes for each cell
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        const centerX = x;
                        const centerY = y;
                        const drawX = originX + (centerX - centerY) * (TILE_WIDTH / 2);
                        const drawY = originY + (centerX + centerY) * (TILE_HEIGHT / 2);

                        ctx.beginPath();
                        ctx.moveTo(drawX, drawY - TILE_HEIGHT / 2);
                        ctx.lineTo(drawX + TILE_WIDTH / 2, drawY);
                        ctx.lineTo(drawX, drawY + TILE_HEIGHT / 2);
                        ctx.lineTo(drawX - TILE_WIDTH / 2, drawY);
                        ctx.closePath();
                        ctx.stroke();
                    }
                }
            }
        }

        // DEBUG OVERLAYS - Dual Grid (shows tile boundaries)
        if (this.showDualGrid) {
            ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
            ctx.lineWidth = 2;

            if (this.renderMode === RenderMode.OrthographicColored) {
                // Orthographic dual grid - offset by half
                for (let y = 0; y < this.height - 1; y++) {
                    for (let x = 0; x < this.width - 1; x++) {
                        const drawX = originX + x * 40;
                        const drawY = originY + y * 40;
                        ctx.strokeRect(drawX, drawY, 40, 40);
                    }
                }
            } else {
                // Isometric dual grid
                for (let y = 0; y < this.height - 1; y++) {
                    for (let x = 0; x < this.width - 1; x++) {
                        const centerX = x + 0.5;
                        const centerY = y + 0.5;
                        const drawX = originX + (centerX - centerY) * (TILE_WIDTH / 2);
                        const drawY = originY + (centerX + centerY) * (TILE_HEIGHT / 2);

                        ctx.beginPath();
                        ctx.moveTo(drawX, drawY - TILE_HEIGHT / 2);
                        ctx.lineTo(drawX + TILE_WIDTH / 2, drawY);
                        ctx.lineTo(drawX, drawY + TILE_HEIGHT / 2);
                        ctx.lineTo(drawX - TILE_WIDTH / 2, drawY);
                        ctx.closePath();
                        ctx.stroke();
                    }
                }
            }
        }

        // DEBUG INDICATORS - Show selected tile and its corners
        if (this.debugTileX >= 0 && this.debugTileY >= 0) {
            const x = this.debugTileX;
            const y = this.debugTileY;

            if (this.renderMode === RenderMode.OrthographicColored) {
                // Draw corner dots in orthographic mode
                const corners = [
                    { cx: x, cy: y },           // TL
                    { cx: x + 1, cy: y },       // TR
                    { cx: x, cy: y + 1 },       // BL
                    { cx: x + 1, cy: y + 1 }    // BR
                ];

                corners.forEach(corner => {
                    const drawX = originX + corner.cx * 40;
                    const drawY = originY + corner.cy * 40;

                    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                    ctx.beginPath();
                    ctx.arc(drawX, drawY, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                });

                // Highlight the tile area
                ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
                ctx.lineWidth = 3;
                ctx.strokeRect(originX + x * 40, originY + y * 40, 40, 40);
            } else {
                // Draw corner dots in isometric mode
                const corners = [
                    { cx: x, cy: y },           // TL
                    { cx: x + 1, cy: y },       // TR
                    { cx: x, cy: y + 1 },       // BL
                    { cx: x + 1, cy: y + 1 }    // BR
                ];

                corners.forEach(corner => {
                    const drawX = originX + (corner.cx - corner.cy) * (TILE_WIDTH / 2);
                    const drawY = originY + (corner.cx + corner.cy) * (TILE_HEIGHT / 2);

                    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                    ctx.beginPath();
                    ctx.arc(drawX, drawY, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                });

                // Highlight the tile area
                const centerX = x + 0.5;
                const centerY = y + 0.5;
                const drawX = originX + (centerX - centerY) * (TILE_WIDTH / 2);
                const drawY = originY + (centerX + centerY) * (TILE_HEIGHT / 2);

                ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(drawX, drawY - TILE_HEIGHT / 2);
                ctx.lineTo(drawX + TILE_WIDTH / 2, drawY);
                ctx.lineTo(drawX, drawY + TILE_HEIGHT / 2);
                ctx.lineTo(drawX - TILE_WIDTH / 2, drawY);
                ctx.closePath();
                ctx.stroke();
            }
        }
    }

    private calculateTilePosition(x: number, y: number, originX: number, originY: number): { drawX: number, drawY: number } {
        let drawX, drawY;

        if (this.renderMode === RenderMode.OrthographicColored) {
            // Standard Top-Down with camera offset
            drawX = originX + x * 40; // 40px square size for top-down debug
            drawY = originY + y * 40;
        } else {
            // Isometric Projection Formula (for both textured and colored)
            // For dual-grid, the tile is centered between 4 corner points
            // We need to offset by 0.5 in both x and y to center the tile
            const centerX = x + 0.5;
            const centerY = y + 0.5;
            drawX = originX + (centerX - centerY) * (TILE_WIDTH / 2);
            drawY = originY + (centerX + centerY) * (TILE_HEIGHT / 2);
        }

        return { drawX, drawY };
    }

    private drawTileByRole(
        ctx: CanvasRenderingContext2D,
        x: number, y: number,
        terrainLayer: TerrainType,
        role: number
    ) {
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
            // Orthographic Colored Mode - draw quadrants based on role bitmask
            const size = 40;
            const half = size / 2;

            ctx.fillStyle = colors[terrainLayer];

            if (role & 1) {  // TL
                ctx.fillRect(x, y, half, half);
            }
            if (role & 2) {  // TR
                ctx.fillRect(x + half, y, half, half);
            }
            if (role & 4) {  // BL
                ctx.fillRect(x, y + half, half, half);
            }
            if (role & 8) {  // BR
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

// Mode buttons
const btnTextured = document.getElementById('btnTextured')!;
const btnColored = document.getElementById('btnColored')!;
const btnOrtho = document.getElementById('btnOrtho')!;

function updateActiveButton() {
    // Remove active class from all mode buttons
    btnTextured.classList.remove('active');
    btnColored.classList.remove('active');
    btnOrtho.classList.remove('active');

    // Add active class to current mode button
    if (grid.renderMode === RenderMode.IsometricTextured) {
        btnTextured.classList.add('active');
    } else if (grid.renderMode === RenderMode.IsometricColored) {
        btnColored.classList.add('active');
    } else {
        btnOrtho.classList.add('active');
    }
}

btnTextured.addEventListener('click', () => {
    console.log("Switching to Isometric Textured mode...");
    grid.renderMode = RenderMode.IsometricTextured;
    updateActiveButton();
});

btnColored.addEventListener('click', () => {
    console.log("Switching to Isometric Colored mode...");
    grid.renderMode = RenderMode.IsometricColored;
    updateActiveButton();
});

btnOrtho.addEventListener('click', () => {
    console.log("Switching to Orthographic mode...");
    grid.renderMode = RenderMode.OrthographicColored;
    updateActiveButton();
});

// Set initial active button
updateActiveButton();

// Layer visibility checkboxes
const chkBaseLayer = document.getElementById('chkBaseLayer') as HTMLInputElement;
const chkTransitionLayer = document.getElementById('chkTransitionLayer') as HTMLInputElement;

chkBaseLayer.addEventListener('change', () => {
    grid.showBaseLayer = chkBaseLayer.checked;
    console.log("Base layer:", grid.showBaseLayer);
});

chkTransitionLayer.addEventListener('change', () => {
    grid.showTransitionLayer = chkTransitionLayer.checked;
    console.log("Transition layer:", grid.showTransitionLayer);
});

// Debug grid checkboxes
const chkWorldGrid = document.getElementById('chkWorldGrid') as HTMLInputElement;
const chkDualGrid = document.getElementById('chkDualGrid') as HTMLInputElement;

chkWorldGrid.addEventListener('change', () => {
    grid.showWorldGrid = chkWorldGrid.checked;
    console.log("World grid:", grid.showWorldGrid);
});

chkDualGrid.addEventListener('change', () => {
    grid.showDualGrid = chkDualGrid.checked;
    console.log("Dual grid:", grid.showDualGrid);
});

// Handle resize
window.addEventListener('resize', () => {
    resizeCanvas();
});

// --- CAMERA PANNING ---
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let dragStartX = 0;
let dragStartY = 0;

canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
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

canvas.addEventListener('mouseup', (e) => {
    // Only treat as click if mouse didn't move much (< 5 pixels)
    const dragDistance = Math.sqrt(
        Math.pow(e.clientX - dragStartX, 2) + Math.pow(e.clientY - dragStartY, 2)
    );

    if (dragDistance < 5) {
        handleTileClick(e);
    }

    isDragging = false;
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
});

// --- DEBUG PANEL ---
const debugPanel = document.getElementById('debugPanel')!;
const debugContent = document.getElementById('debugContent')!;
const closeDebugBtn = document.getElementById('closeDebug')!;

closeDebugBtn.addEventListener('click', () => {
    debugPanel.classList.remove('open');
});

function handleTileClick(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Convert screen coordinates to grid coordinates
    const gridCoords = screenToGrid(canvasX, canvasY);

    if (gridCoords) {
        const debugInfo = grid.getDebugInfo(gridCoords.x, gridCoords.y);
        if (debugInfo) {
            selectedTileDebugInfo = debugInfo;
            grid.setDebugTile(gridCoords.x, gridCoords.y);
            displayDebugInfo(debugInfo);
            debugPanel.classList.add('open');
        }
    }
}

function screenToGrid(screenX: number, screenY: number): { x: number; y: number } | null {
    const originX = canvas.width / 2 + grid.cameraOffsetX;
    const originY = canvas.height / 2 + grid.cameraOffsetY;

    if (grid.renderMode === RenderMode.OrthographicColored) {
        // Orthographic mode - simple calculation
        const gridX = Math.floor((screenX - originX) / 40);
        const gridY = Math.floor((screenY - originY) / 40);
        return { x: gridX, y: gridY };
    } else {
        // Isometric mode - inverse transformation
        // Convert screen position relative to origin
        const relX = screenX - originX;
        const relY = screenY - originY;

        // Inverse isometric projection
        // Original: drawX = (x - y) * (TILE_WIDTH / 2), drawY = (x + y) * (TILE_HEIGHT / 2)
        // Solving for x and y:
        const x = (relX / (TILE_WIDTH / 2) + relY / (TILE_HEIGHT / 2)) / 2;
        const y = (relY / (TILE_HEIGHT / 2) - relX / (TILE_WIDTH / 2)) / 2;

        // Adjust for the 0.5 offset used in rendering (centering)
        const gridX = Math.floor(x);
        const gridY = Math.floor(y);

        return { x: gridX, y: gridY };
    }
}

function getTerrainName(terrain: TerrainType): string {
    return ['Water', 'Sand', 'Dirt', 'Grass'][terrain];
}

function getTerrainClass(terrain: TerrainType): string {
    return ['terrain-water', 'terrain-sand', 'terrain-dirt', 'terrain-grass'][terrain];
}

function formatBitmask(role: number): string {
    const bits = [
        role & 1 ? 'TL' : '--',
        role & 2 ? 'TR' : '--',
        role & 4 ? 'BL' : '--',
        role & 8 ? 'BR' : '--'
    ];
    return `${bits.join(' ')} (${role})`;
}

function displayDebugInfo(info: TileDebugInfo) {
    // Count unique terrain types
    const uniqueTerrains = new Set([
        info.corners.tl,
        info.corners.tr,
        info.corners.bl,
        info.corners.br
    ]).size;

    const html = `
        <div class="debug-section">
            <h4>Tile Position</h4>
            <div class="debug-row">
                <span class="debug-label">Grid Coordinates:</span>
                <span class="debug-value">(${info.gridX}, ${info.gridY})</span>
            </div>
            <div class="debug-row">
                <span class="debug-label">Unique Terrains:</span>
                <span class="debug-value" style="color: ${uniqueTerrains > 3 ? '#ff8866' : uniqueTerrains > 2 ? '#ffbb44' : '#66dd66'}">${uniqueTerrains} ${uniqueTerrains > 3 ? '⚠️ Complex!' : ''}</span>
            </div>
        </div>

        <div class="debug-section">
            <h4>Corner Terrain Types</h4>
            <div class="debug-row">
                <span class="debug-label">Top-Left:</span>
                <span class="debug-value ${getTerrainClass(info.corners.tl)}">${getTerrainName(info.corners.tl)}</span>
            </div>
            <div class="debug-row">
                <span class="debug-label">Top-Right:</span>
                <span class="debug-value ${getTerrainClass(info.corners.tr)}">${getTerrainName(info.corners.tr)}</span>
            </div>
            <div class="debug-row">
                <span class="debug-label">Bottom-Left:</span>
                <span class="debug-value ${getTerrainClass(info.corners.bl)}">${getTerrainName(info.corners.bl)}</span>
            </div>
            <div class="debug-row">
                <span class="debug-label">Bottom-Right:</span>
                <span class="debug-value ${getTerrainClass(info.corners.br)}">${getTerrainName(info.corners.br)}</span>
            </div>
        </div>

        <div class="debug-section">
            <h4>Base Layer</h4>
            <div class="debug-row">
                <span class="debug-label">Terrain:</span>
                <span class="debug-value ${getTerrainClass(info.baseLayer.terrain)}">${getTerrainName(info.baseLayer.terrain)}</span>
            </div>
            <div class="debug-row">
                <span class="debug-label">Role:</span>
                <span class="debug-value">${info.baseLayer.role} (Full Tile)</span>
            </div>
            <div class="debug-row">
                <span class="debug-label">Tile ID:</span>
                <span class="debug-value">${info.baseLayer.tileId ?? 'N/A'}</span>
            </div>
        </div>

        ${info.transitionLayers.map(layer => `
            <div class="debug-section" style="border-left: 3px solid ${layer.drawn ? '#4da6ff' : '#666'}">
                <h4>${getTerrainName(layer.terrain)} Layer ${layer.drawn ? '✓ DRAWN' : '✗ SKIPPED'}</h4>
                <div class="debug-row">
                    <span class="debug-label">Role Bitmask:</span>
                    <span class="debug-value">${formatBitmask(layer.role)}</span>
                </div>
                <div class="debug-row">
                    <span class="debug-label">Tile ID:</span>
                    <span class="debug-value">${layer.tileId ?? 'N/A'}</span>
                </div>
                <div class="debug-row">
                    <span class="debug-label">Status:</span>
                    <span class="debug-value" style="color: ${layer.drawn ? '#66dd66' : '#ff8866'}">${layer.reason}</span>
                </div>
            </div>
        `).join('')}
    `;

    debugContent.innerHTML = html;
}
