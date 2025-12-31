import { createNoise2D } from 'simplex-noise';

// --- CONFIGURATION ---
const TILE_WIDTH = 64;   // Width of the tile in pixels
const TILE_HEIGHT = 32;  // Height (usually half width for standard ISO)
const GRID_SIZE = 100;   // Size of the data grid (100x100)

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

interface MapConfig {
    scale: number;
    seed: number | null;
    size: number;
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
        tl: TerrainType;  // Top visual corner (North)
        tr: TerrainType;  // Right visual corner (East)
        bl: TerrainType;  // Bottom visual corner (South)
        br: TerrainType;  // Left visual corner (West)
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
    public renderMode: RenderMode = RenderMode.IsometricColored;
    public cameraOffsetX: number = 0;
    public cameraOffsetY: number = 0;
    public zoomLevel: number = 1.0;
    public showBaseLayer: boolean = true;
    public showTransitionLayer: boolean = true;
    public showWorldGrid: boolean = false;
    public showDualGrid: boolean = false;
    public showMinimap: boolean = true;
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

        // In isometric view, the visual corners map to grid positions as:
        // Visual TOP (North) = grid (x, y)
        // Visual RIGHT (East) = grid (x+1, y)
        // Visual BOTTOM (South) = grid (x+1, y+1)
        // Visual LEFT (West) = grid (x, y+1)
        //
        // Standard naming: TL=top, TR=right, BL=bottom, BR=left (visual corners)
        const tl = this.getCell(x, y);          // Top corner (North)
        const tr = this.getCell(x + 1, y);      // Right corner (East)
        const bl = this.getCell(x + 1, y + 1);  // Bottom corner (South)
        const br = this.getCell(x, y + 1);      // Left corner (West)

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
            // Wang tile bitmask - each bit represents a visual corner:
            // Bit 1 = Top visual corner (tl)
            // Bit 2 = Right visual corner (tr)
            // Bit 4 = Bottom visual corner (bl)
            // Bit 8 = Left visual corner (br)
            let role = 0;
            if (tl >= currentLayer) role |= 1;  // Top corner
            if (tr >= currentLayer) role |= 2;  // Right corner
            if (bl >= currentLayer) role |= 4;  // Bottom corner
            if (br >= currentLayer) role |= 8;  // Left corner

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

    public generatePerlinMap(config: MapConfig = { scale: 0.015, seed: null, size: this.width }) {
        // Scale affects the "zoom" of the noise. Lower = larger continents.
        const scale = config.scale;
        const seed = config.seed !== null ? config.seed : Math.random() * 1000;

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

        // Save context state
        ctx.save();
        
        // Apply zoom transformation
        ctx.translate(canvasWidth / 2, canvasHeight / 2);
        ctx.scale(this.zoomLevel, this.zoomLevel);
        ctx.translate(-canvasWidth / 2, -canvasHeight / 2);

        // Center the isometric map in the canvas with camera offset
        const originX = canvasWidth / 2 + this.cameraOffsetX;
        const originY = canvasHeight / 2 + this.cameraOffsetY;

        // TWO-PASS RENDERING SYSTEM:
        // Pass 1: Base layer - draw full tiles (role 15 = all 4 corners match)
        // Pass 2: Transition layer - draw edge/corner tiles (role != 15)

        // PASS 1: BASE FULL TILES
        // Draw the lowest terrain type from the 4 corners as a full tile background
        // This provides a base for transition tiles to draw on top of
        if (this.showBaseLayer) {
            for (let y = 0; y < this.height - 1; y++) {
                for (let x = 0; x < this.width - 1; x++) {
                    // Map grid positions to visual isometric corners
                    const tl = this.getCell(x, y);          // Top corner (North)
                    const tr = this.getCell(x + 1, y);      // Right corner (East)
                    const bl = this.getCell(x + 1, y + 1);  // Bottom corner (South)
                    const br = this.getCell(x, y + 1);      // Left corner (West)

                    // Draw the lowest terrain type as the base
                    const minTerrain = Math.min(tl, tr, bl, br);
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
                        // Map grid positions to visual isometric corners
                        // Visual TOP (North) = grid (x, y)
                        // Visual RIGHT (East) = grid (x+1, y)
                        // Visual BOTTOM (South) = grid (x+1, y+1)
                        // Visual LEFT (West) = grid (x, y+1)
                        const tl = this.getCell(x, y);          // Top corner (North)
                        const tr = this.getCell(x + 1, y);      // Right corner (East)
                        const bl = this.getCell(x + 1, y + 1);  // Bottom corner (South)
                        const br = this.getCell(x, y + 1);      // Left corner (West)

                        // Calculate Wang tile bitmask for this layer
                        // Each bit represents whether a visual corner has terrain >= currentLayer
                        // Bit 1 = Top visual corner (tl)
                        // Bit 2 = Right visual corner (tr)
                        // Bit 4 = Bottom visual corner (bl)
                        // Bit 8 = Left visual corner (br)
                        let role = 0;
                        if (tl >= currentLayer) role |= 1;  // Top corner
                        if (tr >= currentLayer) role |= 2;  // Right corner
                        if (bl >= currentLayer) role |= 4;  // Bottom corner
                        if (br >= currentLayer) role |= 8;  // Left corner

                        // Skip if role is 0 (no corners) or 15 (full tile, already in base layer)
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
                // Visual corners map to grid positions:
                const corners = [
                    { cx: x, cy: y },           // TL = Top (North)
                    { cx: x + 1, cy: y },       // TR = Right (East)
                    { cx: x + 1, cy: y + 1 },   // BL = Bottom (South)
                    { cx: x, cy: y + 1 }        // BR = Left (West)
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
            if (!assets) {
                console.warn(`[RENDER] No assets found for terrain: ${TerrainType[terrainLayer]}`);
                return;
            }

            // Get the tile ID from the wang data
            const tileId = assets.roleToId.get(role);
            if (tileId === undefined) {
                console.warn(`[RENDER] No tile ID mapping for ${TerrainType[terrainLayer]} role ${role}`);
                return;
            }

            // Validate image is loaded
            if (!assets.image.complete) {
                console.warn(`[RENDER] Image not loaded for ${TerrainType[terrainLayer]}`);
                return;
            }
            if (assets.image.naturalWidth === 0 || assets.image.naturalHeight === 0) {
                console.warn(`[RENDER] Invalid image dimensions for ${TerrainType[terrainLayer]}: ${assets.image.naturalWidth}x${assets.image.naturalHeight}`);
                return;
            }

            // Draw the sprite from the atlas
            // Tiles are arranged in 2 rows: IDs 0-7 on row 0, IDs 8-14 on row 1
            // Each row can hold 8 tiles (512px / 64px = 8)
            const tilesPerRow = 8;
            const row = Math.floor(tileId / tilesPerRow);
            const col = tileId % tilesPerRow;
            const srcX = col * TILE_WIDTH;
            const srcY = row * TILE_HEIGHT;

            // Validate sprite sheet has enough space for this tile
            const requiredWidth = srcX + TILE_WIDTH;
            const requiredHeight = srcY + TILE_HEIGHT;
            if (assets.image.naturalWidth < requiredWidth || assets.image.naturalHeight < requiredHeight) {
                console.warn(`[RENDER] Sprite sheet too small for ${TerrainType[terrainLayer]} tile ${tileId} (row ${row}, col ${col}): needs ${requiredWidth}x${requiredHeight}px, has ${assets.image.naturalWidth}x${assets.image.naturalHeight}px`);
                return;
            }

            // Center the tile on the draw position
            ctx.drawImage(
                assets.image,
                srcX, srcY, TILE_WIDTH, TILE_HEIGHT,
                x - TILE_WIDTH / 2, y - TILE_HEIGHT / 2,
                TILE_WIDTH, TILE_HEIGHT
            );

            // Log successful draws (comment out once debugging is complete)
            console.log(`[RENDER] Drew ${TerrainType[terrainLayer]} tile ${tileId} (role ${role}) at grid (${Math.round((x + y/2) / 32)}, ${Math.round((y - x/2) / 32)})`);

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

            // Bit 1 = Top visual corner -> top-left quadrant
            if (role & 1) {
                ctx.fillRect(x, y, half, half);
            }
            // Bit 2 = Right visual corner -> top-right quadrant
            if (role & 2) {
                ctx.fillRect(x + half, y, half, half);
            }
            // Bit 4 = Bottom visual corner -> bottom-left quadrant
            if (role & 4) {
                ctx.fillRect(x, y + half, half, half);
            }
            // Bit 8 = Left visual corner -> bottom-right quadrant
            if (role & 8) {
                ctx.fillRect(x + half, y + half, half, half);
            }
        }
        
        // Restore context state (undo zoom transformation)
        ctx.restore();
    }
    
    public exportToImage(): HTMLCanvasElement | null {
        // Create an offscreen canvas to render the full map
        const tileWidth = this.renderMode === RenderMode.OrthographicColored ? 40 : TILE_WIDTH;
        const tileHeight = this.renderMode === RenderMode.OrthographicColored ? 40 : TILE_HEIGHT;

        // Calculate canvas size based on render mode
        let canvasWidth: number;
        let canvasHeight: number;

        if (this.renderMode === RenderMode.OrthographicColored) {
            // Orthographic: simple grid
            canvasWidth = (this.width - 1) * tileWidth;
            canvasHeight = (this.height - 1) * tileHeight;
        } else {
            // Isometric: diamond-shaped projection
            // Width = (width + height - 1) * (TILE_WIDTH / 2)
            // Height = (width + height - 1) * (TILE_HEIGHT / 2) + TILE_HEIGHT
            canvasWidth = (this.width + this.height - 1) * (TILE_WIDTH / 2) + TILE_WIDTH;
            canvasHeight = (this.width + this.height - 1) * (TILE_HEIGHT / 2) + TILE_HEIGHT;
        }

        // Check if canvas size exceeds browser limits
        // Most browsers support max 16384x16384, but we'll use a conservative limit
        const MAX_DIMENSION = 16384;
        const MAX_PIXELS = 100_000_000; // 100 megapixels (conservative limit)

        if (canvasWidth > MAX_DIMENSION || canvasHeight > MAX_DIMENSION) {
            console.error(`Export failed: Canvas dimensions (${canvasWidth}×${canvasHeight}) exceed maximum (${MAX_DIMENSION}×${MAX_DIMENSION})`);
            return null;
        }

        const totalPixels = canvasWidth * canvasHeight;
        if (totalPixels > MAX_PIXELS) {
            console.error(`Export failed: Total pixels (${totalPixels.toLocaleString()}) exceed maximum (${MAX_PIXELS.toLocaleString()})`);
            return null;
        }

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = canvasWidth;
        exportCanvas.height = canvasHeight;
        const exportCtx = exportCanvas.getContext('2d')!;

        // Fill with background
        exportCtx.fillStyle = '#0d0d0d';
        exportCtx.fillRect(0, 0, canvasWidth, canvasHeight);

        if (!assetsLoaded) return exportCanvas;

        // Calculate origin (center of canvas, no camera offset)
        const originX = canvasWidth / 2;
        const originY = this.renderMode === RenderMode.OrthographicColored
            ? 0  // Top-left for orthographic
            : canvasHeight / 2 - (this.height - 1) * (TILE_HEIGHT / 2) / 2;  // Center vertically for isometric

        // PASS 1: BASE FULL TILES
        if (this.showBaseLayer) {
            for (let y = 0; y < this.height - 1; y++) {
                for (let x = 0; x < this.width - 1; x++) {
                    const tl = this.getCell(x, y);
                    const tr = this.getCell(x + 1, y);
                    const bl = this.getCell(x + 1, y + 1);
                    const br = this.getCell(x, y + 1);

                    const minTerrain = Math.min(tl, tr, bl, br);
                    const { drawX, drawY } = this.calculateExportTilePosition(x, y, originX, originY);
                    this.drawTileByRoleExport(exportCtx, drawX, drawY, minTerrain, 15);
                }
            }
        }

        // PASS 2: TRANSITION TILES
        if (this.showTransitionLayer) {
            const layerOrder = [TerrainType.Sand, TerrainType.Dirt, TerrainType.Grass];

            for (const currentLayer of layerOrder) {
                for (let y = 0; y < this.height - 1; y++) {
                    for (let x = 0; x < this.width - 1; x++) {
                        const tl = this.getCell(x, y);
                        const tr = this.getCell(x + 1, y);
                        const bl = this.getCell(x + 1, y + 1);
                        const br = this.getCell(x, y + 1);

                        let role = 0;
                        if (tl >= currentLayer) role |= 1;
                        if (tr >= currentLayer) role |= 2;
                        if (bl >= currentLayer) role |= 4;
                        if (br >= currentLayer) role |= 8;

                        if (role === 0 || role === 15) continue;

                        const { drawX, drawY } = this.calculateExportTilePosition(x, y, originX, originY);
                        this.drawTileByRoleExport(exportCtx, drawX, drawY, currentLayer, role);
                    }
                }
            }
        }

        return exportCanvas;
    }

    private calculateExportTilePosition(x: number, y: number, originX: number, originY: number): { drawX: number, drawY: number } {
        let drawX, drawY;

        if (this.renderMode === RenderMode.OrthographicColored) {
            drawX = originX + x * 40;
            drawY = originY + y * 40;
        } else {
            const centerX = x + 0.5;
            const centerY = y + 0.5;
            drawX = originX + (centerX - centerY) * (TILE_WIDTH / 2);
            drawY = originY + (centerX + centerY) * (TILE_HEIGHT / 2);
        }

        return { drawX, drawY };
    }

    private drawTileByRoleExport(
        ctx: CanvasRenderingContext2D,
        x: number, y: number,
        terrainLayer: TerrainType,
        role: number
    ) {
        if (role === 0) return;

        const colors = {
            [TerrainType.Water]: '#225588',
            [TerrainType.Sand]:  '#eebb44',
            [TerrainType.Dirt]:  '#885533',
            [TerrainType.Grass]: '#44aa44'
        };

        if (this.renderMode === RenderMode.IsometricTextured) {
            const assets = terrainAssets.get(terrainLayer);
            if (!assets || !assets.image.complete) return;

            const tileId = assets.roleToId.get(role);
            if (tileId === undefined) return;

            const tilesPerRow = 8;
            const row = Math.floor(tileId / tilesPerRow);
            const col = tileId % tilesPerRow;
            const srcX = col * TILE_WIDTH;
            const srcY = row * TILE_HEIGHT;

            ctx.drawImage(
                assets.image,
                srcX, srcY, TILE_WIDTH, TILE_HEIGHT,
                x - TILE_WIDTH / 2, y - TILE_HEIGHT / 2,
                TILE_WIDTH, TILE_HEIGHT
            );
        } else if (this.renderMode === RenderMode.IsometricColored) {
            ctx.fillStyle = colors[terrainLayer];
            ctx.beginPath();
            ctx.moveTo(x, y - TILE_HEIGHT / 2);
            ctx.lineTo(x + TILE_WIDTH / 2, y);
            ctx.lineTo(x, y + TILE_HEIGHT / 2);
            ctx.lineTo(x - TILE_WIDTH / 2, y);
            ctx.closePath();
            ctx.fill();
        } else {
            const size = 40;
            const half = size / 2;
            ctx.fillStyle = colors[terrainLayer];

            if (role & 1) ctx.fillRect(x, y, half, half);
            if (role & 2) ctx.fillRect(x + half, y, half, half);
            if (role & 4) ctx.fillRect(x, y + half, half, half);
            if (role & 8) ctx.fillRect(x + half, y + half, half, half);
        }
    }

    public renderMinimap(ctx: CanvasRenderingContext2D, width: number, height: number, canvasWidth: number, canvasHeight: number) {
        // Clear minimap
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, width, height);
        
        if (!assetsLoaded) return;
        
        // Calculate pixel size for each grid cell
        const pixelWidth = width / this.width;
        const pixelHeight = height / this.height;
        
        // Terrain colors for minimap
        const terrainColors: Record<TerrainType, string> = {
            [TerrainType.Water]: '#4da6ff',
            [TerrainType.Sand]: '#ffcc66',
            [TerrainType.Dirt]: '#cc8855',
            [TerrainType.Grass]: '#66dd66'
        };
        
        // Draw each cell as a colored pixel
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const terrain = this.getCell(x, y);
                ctx.fillStyle = terrainColors[terrain];
                ctx.fillRect(
                    Math.floor(x * pixelWidth),
                    Math.floor(y * pixelHeight),
                    Math.ceil(pixelWidth),
                    Math.ceil(pixelHeight)
                );
            }
        }
        
        // Draw viewport indicator box
        let centerGridX: number;
        let centerGridY: number;
        let visibleTilesX: number;
        let visibleTilesY: number;

        if (this.renderMode === RenderMode.OrthographicColored) {
            // ORTHOGRAPHIC MODE - simple direct calculation
            // Origin is at center of canvas, offset by camera
            const originX = canvasWidth / 2 + this.cameraOffsetX;
            const originY = canvasHeight / 2 + this.cameraOffsetY;

            // Tile size in orthographic mode
            const orthoTileSize = 40;

            // Top-left corner of viewport in screen space is at (0, 0)
            // Convert to grid coordinates
            const viewportLeft = -originX / (orthoTileSize * this.zoomLevel);
            const viewportTop = -originY / (orthoTileSize * this.zoomLevel);

            // How many tiles fit in the viewport
            visibleTilesX = canvasWidth / (orthoTileSize * this.zoomLevel);
            visibleTilesY = canvasHeight / (orthoTileSize * this.zoomLevel);

            // Center is at the middle of the viewport
            centerGridX = viewportLeft + visibleTilesX / 2;
            centerGridY = viewportTop + visibleTilesY / 2;
        } else {
            // ISOMETRIC MODE - requires inverse transformation
            // Use the same logic as screenToGrid function

            const originX = canvasWidth / 2 + this.cameraOffsetX;
            const originY = canvasHeight / 2 + this.cameraOffsetY;

            // Find the grid coordinates of the viewport center (center of screen)
            // Center of screen is at (canvasWidth/2, canvasHeight/2)
            const centerScreenX = canvasWidth / 2;
            const centerScreenY = canvasHeight / 2;

            // Convert to position relative to origin
            const relX = centerScreenX - originX;
            const relY = centerScreenY - originY;

            // Apply inverse isometric transformation (accounting for zoom)
            // Original projection: drawX = (gridX - gridY) * (TILE_WIDTH/2), drawY = (gridX + gridY) * (TILE_HEIGHT/2)
            // Inverse: gridX = (relX/(TILE_WIDTH/2) + relY/(TILE_HEIGHT/2)) / 2
            //          gridY = (relY/(TILE_HEIGHT/2) - relX/(TILE_WIDTH/2)) / 2
            const scaledTileWidth = TILE_WIDTH * this.zoomLevel;
            const scaledTileHeight = TILE_HEIGHT * this.zoomLevel;

            centerGridX = (relX / (scaledTileWidth / 2) + relY / (scaledTileHeight / 2)) / 2;
            centerGridY = (relY / (scaledTileHeight / 2) - relX / (scaledTileWidth / 2)) / 2;

            // Calculate visible area - approximate based on screen dimensions
            // In isometric view, we see roughly a diamond-shaped area
            // Approximate with a rectangle that's larger to account for diamond shape
            visibleTilesX = canvasWidth / (scaledTileWidth) * 2.0;
            visibleTilesY = canvasHeight / (scaledTileHeight) * 2.0;
        }
        
        // Draw viewport indicator
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(255, 255, 0, 0.1)';

        if (this.renderMode === RenderMode.OrthographicColored) {
            // Draw rectangle for orthographic view
            const viewportGridLeft = centerGridX - visibleTilesX / 2;
            const viewportGridTop = centerGridY - visibleTilesY / 2;

            const viewportMinimapX = viewportGridLeft * pixelWidth;
            const viewportMinimapY = viewportGridTop * pixelHeight;
            const viewportMinimapWidth = visibleTilesX * pixelWidth;
            const viewportMinimapHeight = visibleTilesY * pixelHeight;

            ctx.strokeRect(
                viewportMinimapX,
                viewportMinimapY,
                viewportMinimapWidth,
                viewportMinimapHeight
            );

            ctx.fillRect(
                viewportMinimapX,
                viewportMinimapY,
                viewportMinimapWidth,
                viewportMinimapHeight
            );
        } else {
            // Draw diamond for isometric view
            // In isometric, the viewport is diamond-shaped in grid space
            // Diamond corners: top, right, bottom, left
            const centerMinimapX = centerGridX * pixelWidth;
            const centerMinimapY = centerGridY * pixelHeight;
            const halfWidth = (visibleTilesX / 2) * pixelWidth;
            const halfHeight = (visibleTilesY / 2) * pixelHeight;

            ctx.beginPath();
            ctx.moveTo(centerMinimapX, centerMinimapY - halfHeight);  // Top
            ctx.lineTo(centerMinimapX + halfWidth, centerMinimapY);   // Right
            ctx.lineTo(centerMinimapX, centerMinimapY + halfHeight);  // Bottom
            ctx.lineTo(centerMinimapX - halfWidth, centerMinimapY);   // Left
            ctx.closePath();

            ctx.fill();
            ctx.stroke();
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

// Minimap setup
const minimapCanvas = document.getElementById('minimapCanvas') as HTMLCanvasElement;
const minimapCtx = minimapCanvas.getContext('2d')!;
minimapCanvas.width = 250;
minimapCanvas.height = 250;

// --- LOOP ---
function loop() {
    // Background
    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (assetsLoaded) {
        grid.render(ctx, canvas.width, canvas.height);
        
        // Render minimap if open
        const minimap = document.getElementById('minimap')!;
        if (minimap.classList.contains('open')) {
            grid.renderMinimap(minimapCtx, minimapCanvas.width, minimapCanvas.height, canvas.width, canvas.height);
        }
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

    // Generate new random seed
    const newSeed = Math.floor(Math.random() * 1000000);
    configSeed.value = newSeed.toString();

    // Use current config values
    const macro = parseFloat(configScaleMacro.value);
    const mid = parseFloat(configScaleMid.value);
    const micro = parseFloat(configScaleMicro.value);
    const scale = macro + mid + micro;
    const size = parseInt(configMapSize.value);

    grid.generatePerlinMap({ scale, seed: newSeed, size });
});

document.getElementById('btnExport')!.addEventListener('click', () => {
    if (!assetsLoaded) {
        alert('Please wait for assets to load before exporting');
        return;
    }

    console.log("Exporting map to image...");

    // Calculate estimated export size for user feedback
    const tileWidth = grid.renderMode === RenderMode.OrthographicColored ? 40 : TILE_WIDTH;
    const tileHeight = grid.renderMode === RenderMode.OrthographicColored ? 40 : TILE_HEIGHT;

    let estimatedWidth: number;
    let estimatedHeight: number;

    if (grid.renderMode === RenderMode.OrthographicColored) {
        estimatedWidth = (grid.width - 1) * tileWidth;
        estimatedHeight = (grid.height - 1) * tileHeight;
    } else {
        estimatedWidth = (grid.width + grid.height - 1) * (TILE_WIDTH / 2) + TILE_WIDTH;
        estimatedHeight = (grid.width + grid.height - 1) * (TILE_HEIGHT / 2) + TILE_HEIGHT;
    }

    // Generate the export canvas
    const exportCanvas = grid.exportToImage();

    if (!exportCanvas) {
        const megapixels = (estimatedWidth * estimatedHeight / 1_000_000).toFixed(1);
        alert(
            `Export failed: Map is too large to export!\n\n` +
            `Current map size: ${grid.width}×${grid.height}\n` +
            `Export dimensions: ${estimatedWidth}×${estimatedHeight} pixels (${megapixels} MP)\n\n` +
            `Recommended maximum map size:\n` +
            `• Isometric modes: ~200×200\n` +
            `• Orthographic mode: ~250×250\n\n` +
            `Please reduce the map size in the configuration panel.`
        );
        return;
    }

    // Convert to blob and download
    exportCanvas.toBlob((blob) => {
        if (!blob) {
            alert('Failed to generate image blob');
            return;
        }

        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const modeNames = ['isometric-textured', 'isometric-colored', 'orthographic'];
        const modeName = modeNames[grid.renderMode];
        link.download = `terrain-map-${modeName}-${timestamp}.png`;

        link.href = url;
        link.click();

        // Clean up
        URL.revokeObjectURL(url);

        console.log(`Exported map as ${link.download} (${estimatedWidth}×${estimatedHeight}px)`);
    }, 'image/png');
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

// Minimap toggle
const minimap = document.getElementById('minimap')!;
const btnMinimap = document.getElementById('btnMinimap')!;

// Show minimap by default
minimap.classList.add('open');

btnMinimap.addEventListener('click', () => {
    minimap.classList.toggle('open');
});

// Keyboard shortcut for minimap (M key)
window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
        // Don't trigger if typing in an input field
        if (document.activeElement?.tagName === 'INPUT') return;
        minimap.classList.toggle('open');
    }
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
    // Display format maps bits to traditional grid corner labels (TL/TR/BL/BR)
    // Note: Visual corners (Top/Right/Bottom/Left) map to traditional labels as:
    // Top visual -> TR label, Right visual -> BR label, Bottom visual -> BL label, Left visual -> TL label
    const bits = [
        role & 1 ? 'TR' : '--',  // bit 1 = Top visual corner -> "TR" label
        role & 2 ? 'BR' : '--',  // bit 2 = Right visual corner -> "BR" label
        role & 4 ? 'BL' : '--',  // bit 4 = Bottom visual corner -> "BL" label
        role & 8 ? 'TL' : '--'   // bit 8 = Left visual corner -> "TL" label
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
                <span class="debug-label">Top (North):</span>
                <span class="debug-value ${getTerrainClass(info.corners.tl)}">${getTerrainName(info.corners.tl)}</span>
            </div>
            <div class="debug-row">
                <span class="debug-label">Right (East):</span>
                <span class="debug-value ${getTerrainClass(info.corners.tr)}">${getTerrainName(info.corners.tr)}</span>
            </div>
            <div class="debug-row">
                <span class="debug-label">Bottom (South):</span>
                <span class="debug-value ${getTerrainClass(info.corners.bl)}">${getTerrainName(info.corners.bl)}</span>
            </div>
            <div class="debug-row">
                <span class="debug-label">Left (West):</span>
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

// --- CONFIG PANEL ---
const configPanel = document.getElementById('configPanel')!;
const btnConfig = document.getElementById('btnConfig')!;
const btnApplyConfig = document.getElementById('btnApplyConfig')!;
const btnRandomSeed = document.getElementById('btnRandomSeed')!;
const configScaleMacro = document.getElementById('configScaleMacro') as HTMLInputElement;
const configScaleMid = document.getElementById('configScaleMid') as HTMLInputElement;
const configScaleMicro = document.getElementById('configScaleMicro') as HTMLInputElement;
const configMapSize = document.getElementById('configMapSize') as HTMLInputElement;
const configSeed = document.getElementById('configSeed') as HTMLInputElement;
const scaleMacroValue = document.getElementById('scaleMacroValue')!;
const scaleMidValue = document.getElementById('scaleMidValue')!;
const scaleMicroValue = document.getElementById('scaleMicroValue')!;
const scaleTotalValue = document.getElementById('scaleTotalValue')!;

// Calculate combined scale from three sliders
function updateCombinedScale() {
    const macro = parseFloat(configScaleMacro.value);
    const mid = parseFloat(configScaleMid.value);
    const micro = parseFloat(configScaleMicro.value);
    const total = macro + mid + micro;
    
    scaleMacroValue.textContent = macro.toFixed(2);
    scaleMidValue.textContent = mid.toFixed(3);
    scaleMicroValue.textContent = micro.toFixed(4);
    scaleTotalValue.textContent = total.toFixed(5);
}

// Toggle config panel
btnConfig.addEventListener('click', () => {
    configPanel.classList.toggle('open');
});

// Update scale display values when sliders change
configScaleMacro.addEventListener('input', updateCombinedScale);
configScaleMid.addEventListener('input', updateCombinedScale);
configScaleMicro.addEventListener('input', updateCombinedScale);

// Generate and display initial seed
const initialSeed = Math.floor(Math.random() * 1000000);
configSeed.value = initialSeed.toString();
grid.generatePerlinMap({ scale: 0.015, seed: initialSeed, size: GRID_SIZE });

// Random seed button
btnRandomSeed.addEventListener('click', () => {
    const randomSeed = Math.floor(Math.random() * 1000000);
    configSeed.value = randomSeed.toString();
});

// Apply configuration and regenerate map
btnApplyConfig.addEventListener('click', () => {
    const newSize = parseInt(configMapSize.value);
    const macro = parseFloat(configScaleMacro.value);
    const mid = parseFloat(configScaleMid.value);
    const micro = parseFloat(configScaleMicro.value);
    const scale = macro + mid + micro;
    const seedInput = configSeed.value.trim();
    const seed = seedInput === '' ? null : parseFloat(seedInput);
    
    // Validate inputs
    if (newSize < 1 || newSize > 500) {
        alert('Map size must be between 1 and 500');
        return;
    }
    
    if (seedInput !== '' && isNaN(seed!)) {
        alert('Seed must be a number or left empty');
        return;
    }
    
    // Rebuild grid if size changed
    if (newSize !== grid.width || newSize !== grid.height) {
        console.log(`Resizing grid from ${grid.width}x${grid.height} to ${newSize}x${newSize}`);
        // Create new grid with new size
        const newGrid = new DualGridSystem(newSize, newSize);
        // Copy over settings
        newGrid.renderMode = grid.renderMode;
        newGrid.cameraOffsetX = grid.cameraOffsetX;
        newGrid.cameraOffsetY = grid.cameraOffsetY;
        newGrid.zoomLevel = grid.zoomLevel;
        newGrid.showBaseLayer = grid.showBaseLayer;
        newGrid.showTransitionLayer = grid.showTransitionLayer;
        newGrid.showWorldGrid = grid.showWorldGrid;
        newGrid.showDualGrid = grid.showDualGrid;
        // Replace global grid reference
        (window as any).grid = newGrid;
        Object.assign(grid, newGrid);
    }
    
    // Generate with config
    const config: MapConfig = { scale, seed, size: newSize };
    grid.generatePerlinMap(config);
    
    console.log(`Map regenerated with config:`, config);
    
    // Close panel
    configPanel.classList.remove('open');
});

