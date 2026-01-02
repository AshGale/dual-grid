# Phaser 3 Dual-Grid Terrain Implementation Guide

This guide explains how to implement the dual-grid noise generation terrain system from this project into Phaser 3. It covers noise generation, the dual-grid concept, Wang tile rendering with custom bitmasks, and the two-pass layer system.

---

## Table of Contents

1. [Overview & Key Concepts](#1-overview--key-concepts)
2. [Noise Generation System](#2-noise-generation-system)
3. [Dual Grid Architecture](#3-dual-grid-architecture)
4. [Wang Tile System Deep Dive](#4-wang-tile-system-deep-dive)
5. [Two-Pass Rendering System](#5-two-pass-rendering-system)
6. [Phaser 3 Specific Implementation](#6-phaser-3-specific-implementation)
7. [Complete Code Examples](#7-complete-code-examples)

---

## 1. Overview & Key Concepts

### What is the Dual-Grid System?

The dual-grid system creates smooth terrain transitions by using **two logical grids**:

1. **Data Grid**: A grid of terrain type values (e.g., 100×100 cells)
   - Each cell stores a terrain type: Water, Sand, Dirt, Grass, etc.
   - Generated using Simplex noise with configurable thresholds

2. **Render Grid**: A grid of tiles to draw (99×99 for a 100×100 data grid)
   - Each rendered tile samples **4 neighboring data cells** as its corners
   - The tile appearance is determined by which corners match the current terrain layer

### Why Use This System?

- **Automatic transitions**: No manual tile placement needed
- **Natural-looking borders**: Wang tiling creates smooth terrain blending
- **Scalable**: Add new terrain types without redesigning transitions
- **Procedural**: Noise generation creates infinite variations

---

## 2. Noise Generation System

### Dependencies

Install the Simplex noise library:
```bash
npm install simplex-noise
```

### Core Data Structures

**Terrain Type Enum** (from [src/main.ts:22-27](src/main.ts#L22-L27)):
```typescript
enum TerrainType {
    Water = 0,
    Sand = 1,
    Dirt = 2,
    Grass = 3
    // Add more as needed
}
```

**Terrain Bucket Interface** (from [src/main.ts:35-42](src/main.ts#L35-L42)):
```typescript
interface TerrainBucket {
    name: string;              // Display name (e.g., "Shallow Water")
    color: string;             // Hex color for debugging (#225588)
    threshold: number;         // Minimum noise value (-1.0 to 1.0)
    terrainType: TerrainType;  // Maps to asset loading
}
```

**Map Configuration** (from [src/main.ts:44-49](src/main.ts#L44-L49)):
```typescript
interface MapConfig {
    scale: number;             // Noise scale (typically 0.015)
    seed: number | null;       // Seed for reproducibility (null = random)
    size: number;              // Grid dimensions (size × size)
    buckets: TerrainBucket[];  // Terrain bucket configurations
}
```

### Default Terrain Buckets

Configure these at game load (from [src/main.ts:72-77](src/main.ts#L72-L77)):
```typescript
const DEFAULT_BUCKETS: TerrainBucket[] = [
    { name: 'Shallow Water', color: '#225588', threshold: -1.0, terrainType: TerrainType.Water },
    { name: 'Sand', color: '#eebb44', threshold: -0.2, terrainType: TerrainType.Sand },
    { name: 'Dirt', color: '#885533', threshold: 0.0, terrainType: TerrainType.Dirt },
    { name: 'Grass', color: '#44aa44', threshold: 0.3, terrainType: TerrainType.Grass }
];
```

**Critical Rules:**
- Buckets MUST be sorted by threshold (lowest to highest)
- First bucket should have threshold = -1.0 (catches all low noise values)
- Thresholds define the **minimum** noise value for that terrain type

### Noise Generation Algorithm

**Complete implementation** (from [src/main.ts:364-392](src/main.ts#L364-L392)):

```typescript
import { createNoise2D } from 'simplex-noise';

class TerrainGenerator {
    private noise2D = createNoise2D();
    private cells: TerrainType[] = [];
    private width: number;
    private height: number;
    private buckets: TerrainBucket[] = [];

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.cells = new Array(width * height).fill(TerrainType.Water);
    }

    public generatePerlinMap(config: MapConfig): void {
        this.buckets = [...config.buckets];
        const scale = config.scale;
        const seed = config.seed !== null ? config.seed : Math.random() * 1000;

        // Sort buckets by threshold (highest to lowest) for easier checking
        const sortedBuckets = [...config.buckets].sort((a, b) => b.threshold - a.threshold);

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                // Get noise value between -1 and 1
                const value = this.noise2D((x + seed) * scale, (y + seed) * scale);

                // Find the appropriate bucket - check from highest threshold to lowest
                let type = sortedBuckets[sortedBuckets.length - 1].terrainType;
                for (const bucket of sortedBuckets) {
                    if (value >= bucket.threshold) {
                        type = bucket.terrainType;
                        break;
                    }
                }

                this.setCell(x, y, type);
            }
        }
    }

    private setCell(x: number, y: number, type: TerrainType): void {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.cells[y * this.width + x] = type;
        }
    }

    public getCell(x: number, y: number): TerrainType {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return TerrainType.Water; // Boundary returns default terrain
        }
        return this.cells[y * this.width + x];
    }
}
```

### Noise Scale Configuration

The scale determines terrain feature size:
- **Small scale (0.005-0.01)**: Large continents, smooth transitions
- **Medium scale (0.015-0.03)**: Balanced terrain with visible features
- **Large scale (0.05-0.1)**: Small, noisy terrain patches

**Multi-component scale** (optional advanced feature):
```typescript
const macroScale = 0.08;   // Large-scale continent formation
const midScale = 0.015;    // Medium-scale terrain features
const microScale = 0.005;  // Fine-detail noise
const totalScale = macroScale + midScale + microScale;
```

### Seed Mechanics

**For new random game:**
```typescript
const config: MapConfig = {
    scale: 0.015,
    seed: null, // Random seed
    size: 100,
    buckets: DEFAULT_BUCKETS
};
```

**For reproducible map:**
```typescript
const config: MapConfig = {
    scale: 0.015,
    seed: 123456, // Specific seed
    size: 100,
    buckets: DEFAULT_BUCKETS
};
```

The seed is added to coordinates before noise sampling:
```typescript
const value = noise2D((x + seed) * scale, (y + seed) * scale);
```

---

## 3. Dual Grid Architecture

### The Fundamental Concept

**Data Grid Storage** (from [src/main.ts:242-275](src/main.ts#L242-L275)):
```typescript
class DualGridSystem {
    public width: number;       // Grid width (number of cells)
    public height: number;      // Grid height (number of cells)
    public cells: TerrainType[]; // 1D array: cells[y * width + x]

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.cells = new Array(width * height).fill(TerrainType.Water);
    }

    public getCell(x: number, y: number): TerrainType {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return TerrainType.Water; // Boundary check
        }
        return this.cells[y * this.width + x];
    }

    public setCell(x: number, y: number, type: TerrainType): void {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.cells[y * this.width + x] = type;
        }
    }
}
```

### Critical: Isometric Corner Mapping

**This is the MOST IMPORTANT concept to understand correctly.**

For a rendered tile at position `(x, y)`, the 4 corner cells are sampled as follows (from [src/main.ts:292-302](src/main.ts#L292-L302)):

```typescript
// Visual corner → Grid position mapping:
const tl = this.getCell(x, y);          // Top visual corner (North)
const tr = this.getCell(x + 1, y);      // Right visual corner (East)
const bl = this.getCell(x + 1, y + 1);  // Bottom visual corner (South)
const br = this.getCell(x, y + 1);      // Left visual corner (West)
```

**Visual Diagram:**
```
       (x, y)
         ●  ← tl (Top/North)
        / \
       /   \
(x,y+1)   (x+1,y)
   ●-------● ← tr (Right/East)
   |       |
   |       |
   br      bl
   ↓       ↓
   (Left)  (Bottom/South)
           ●
      (x+1, y+1)
```

**Variable Naming Convention:**
- `tl` = Top-Left visual = Top/North corner
- `tr` = Top-Right visual = Right/East corner
- `bl` = Bottom-Left visual = Bottom/South corner (NOT Bottom-Right!)
- `br` = Bottom-Right visual = Left/West corner (NOT Bottom-Left!)

This naming is **visual-based**, not traditional grid-based. It must be consistent everywhere.

### How to Query Terrain from Game Logic

**Example: "Is this tile grass?"**
```typescript
function isTileGrass(x: number, y: number, grid: DualGridSystem): boolean {
    const tl = grid.getCell(x, y);
    const tr = grid.getCell(x + 1, y);
    const bl = grid.getCell(x + 1, y + 1);
    const br = grid.getCell(x, y + 1);

    // Check if ALL corners are grass (fully grass tile)
    return tl === TerrainType.Grass &&
           tr === TerrainType.Grass &&
           bl === TerrainType.Grass &&
           br === TerrainType.Grass;
}
```

**Example: "Does this tile contain any water?"**
```typescript
function tileHasWater(x: number, y: number, grid: DualGridSystem): boolean {
    const tl = grid.getCell(x, y);
    const tr = grid.getCell(x + 1, y);
    const bl = grid.getCell(x + 1, y + 1);
    const br = grid.getCell(x, y + 1);

    return tl === TerrainType.Water ||
           tr === TerrainType.Water ||
           bl === TerrainType.Water ||
           br === TerrainType.Water;
}
```

**Example: "Get the dominant terrain type"**
```typescript
function getDominantTerrain(x: number, y: number, grid: DualGridSystem): TerrainType {
    const tl = grid.getCell(x, y);
    const tr = grid.getCell(x + 1, y);
    const bl = grid.getCell(x + 1, y + 1);
    const br = grid.getCell(x, y + 1);

    // Count occurrences
    const counts = new Map<TerrainType, number>();
    [tl, tr, bl, br].forEach(terrain => {
        counts.set(terrain, (counts.get(terrain) || 0) + 1);
    });

    // Find max count
    let dominant = tl;
    let maxCount = 0;
    counts.forEach((count, terrain) => {
        if (count > maxCount) {
            maxCount = count;
            dominant = terrain;
        }
    });

    return dominant;
}
```

**Example: "Get the base (lowest) terrain type"**
```typescript
function getBaseTerrain(x: number, y: number, grid: DualGridSystem): TerrainType {
    const tl = grid.getCell(x, y);
    const tr = grid.getCell(x + 1, y);
    const bl = grid.getCell(x + 1, y + 1);
    const br = grid.getCell(x, y + 1);

    return Math.min(tl, tr, bl, br) as TerrainType;
}
```

### Render Grid vs Data Grid

**Key relationship:**
- Data grid: `width × height` cells
- Render grid: `(width - 1) × (height - 1)` tiles

**Example:**
- 100×100 data grid → 99×99 rendered tiles
- Each tile samples 4 cells, so the last row/column of cells don't get their own tiles

**Iteration pattern:**
```typescript
// Render all tiles
for (let y = 0; y < grid.height - 1; y++) {
    for (let x = 0; x < grid.width - 1; x++) {
        renderTile(x, y, grid);
    }
}
```

---

## 4. Wang Tile System Deep Dive

### Atlas JSON Format

**File structure example** (from `grass.txt`, `shallow-water.txt`):
```json
{
  "tile_width": 64,
  "tile_height": 32,
  "wang_sets": [
    {
      "members": [
        { "id": 0, "role": 4 },
        { "id": 1, "role": 6 },
        { "id": 2, "role": 2 },
        { "id": 3, "role": 12 },
        { "id": 4, "role": 15 },
        { "id": 5, "role": 3 },
        { "id": 6, "role": 8 },
        { "id": 7, "role": 9 },
        { "id": 8, "role": 1 },
        { "id": 9, "role": 11 },
        { "id": 10, "role": 13 },
        { "id": 11, "role": 5 },
        { "id": 12, "role": 7 },
        { "id": 13, "role": 14 },
        { "id": 14, "role": 10 }
      ]
    }
  ]
}
```

**Field explanations:**
- `tile_width`: Width of each tile in pixels (64)
- `tile_height`: Height of each tile in pixels (32)
- `wang_sets[0].members`: Array of 15 tile definitions
- `id`: Position in the sprite atlas (0-14)
- `role`: Wang tile bitmask value (1-15)

### TypeScript Interfaces

**Complete type definitions** (from [src/main.ts:51-66](src/main.ts#L51-L66)):
```typescript
interface WangTileMember {
    id: number;    // Atlas index (0-14)
    role: number;  // Bitmask value (1-15)
}

interface WangTileData {
    tile_width: number;
    tile_height: number;
    wang_sets: Array<{
        members: WangTileMember[];
    }>;
}

interface TerrainAssets {
    image: HTMLImageElement;           // Sprite sheet
    wangData: WangTileData;            // Metadata
    roleToId: Map<number, number>;     // Fast lookup: role → id
}
```

### Bitmask System Explained

**The Wang tile bitmask determines which corners match the current terrain layer.**

**Corner-to-Bit Mapping:**
- **Bit 1** (value 1): Top visual corner (tl)
- **Bit 2** (value 2): Right visual corner (tr)
- **Bit 4** (value 4): Bottom visual corner (bl)
- **Bit 8** (value 8): Left visual corner (br)

**Role Calculation Formula** (from [src/main.ts:451-461](src/main.ts#L451-L461)):
```typescript
function calculateRole(
    tl: TerrainType,
    tr: TerrainType,
    bl: TerrainType,
    br: TerrainType,
    currentLayer: TerrainType
): number {
    let role = 0;
    if (tl >= currentLayer) role |= 1;  // Bit 1: Top corner
    if (tr >= currentLayer) role |= 2;  // Bit 2: Right corner
    if (bl >= currentLayer) role |= 4;  // Bit 4: Bottom corner
    if (br >= currentLayer) role |= 8;  // Bit 8: Left corner
    return role;
}
```

**Why `>=` instead of `==`?**

The comparison uses `>=` because we're checking if a corner's terrain is **at least** as high priority as the current layer. This ensures:
- Lower terrain (e.g., Water = 0) never matches higher layers (e.g., Grass = 3)
- Equal or higher terrain matches the current layer
- This creates the transition effect

### Role Value Examples

**Example 1: All corners match** (role 15)
```typescript
tl = Grass, tr = Grass, bl = Grass, br = Grass
currentLayer = Grass

role = 0
if (Grass >= Grass) role |= 1  → role = 1
if (Grass >= Grass) role |= 2  → role = 3
if (Grass >= Grass) role |= 4  → role = 7
if (Grass >= Grass) role |= 8  → role = 15

// Binary: 1111 (all 4 bits set)
// This is a FULL TILE
```

**Example 2: Top and right corners match** (role 3)
```typescript
tl = Grass, tr = Grass, bl = Sand, br = Sand
currentLayer = Grass

role = 0
if (Grass >= Grass) role |= 1  → role = 1
if (Grass >= Grass) role |= 2  → role = 3
if (Sand >= Grass) → false     → role = 3
if (Sand >= Grass) → false     → role = 3

// Binary: 0011 (bits 1 and 2 set)
// This is a PARTIAL TILE (top-right corner has grass)
```

**Example 3: No corners match** (role 0)
```typescript
tl = Water, tr = Water, bl = Water, br = Water
currentLayer = Grass

role = 0
if (Water >= Grass) → false  → role = 0
if (Water >= Grass) → false  → role = 0
if (Water >= Grass) → false  → role = 0
if (Water >= Grass) → false  → role = 0

// Binary: 0000 (no bits set)
// This tile is SKIPPED (no grass to render)
```

### Role to Tile ID Lookup

**Fast lookup implementation** (from [src/main.ts:134-146](src/main.ts#L134-L146)):
```typescript
function buildRoleToIdMap(wangData: WangTileData): Map<number, number> {
    const roleToId = new Map<number, number>();

    if (wangData.wang_sets && wangData.wang_sets[0]) {
        wangData.wang_sets[0].members.forEach(member => {
            roleToId.set(member.role, member.id);
        });
    }

    return roleToId;
}

// Usage:
const tileId = roleToId.get(role); // O(1) lookup
```

**Example lookup:**
```
role = 15 → id = 4  (from the JSON above)
role = 3  → id = 5
role = 7  → id = 12
```

### Sprite Atlas Layout

**Atlas format:** 512×64px (16 tiles total: 8 per row, 2 rows)

**Tile extraction** (from [src/main.ts:694-710](src/main.ts#L694-L710)):
```typescript
const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;

function getTilePosition(tileId: number): { srcX: number; srcY: number } {
    const tilesPerRow = 8;  // 512px / 64px = 8 tiles per row
    const row = Math.floor(tileId / tilesPerRow);  // 0 or 1
    const col = tileId % tilesPerRow;              // 0-7

    return {
        srcX: col * TILE_WIDTH,   // 0, 64, 128, 192, 256, 320, 384, 448
        srcY: row * TILE_HEIGHT   // 0 or 32
    };
}
```

**Visual layout:**
```
Row 0: [0] [1] [2] [3] [4] [5] [6] [7]
Row 1: [8] [9] [10][11][12][13][14]
       ↑    ↑   ↑   ↑   ↑   ↑   ↑
     Only 7 tiles used in row 1 (role 0 is never rendered)
```

### Complete Asset Loading Example

**Loading all terrain assets** (from [src/main.ts:104-154](src/main.ts#L104-L154)):
```typescript
async function loadTerrainAssets(
    buckets: TerrainBucket[]
): Promise<Map<TerrainType, TerrainAssets>> {
    const terrainAssets = new Map<TerrainType, TerrainAssets>();

    const promises = buckets.map(async (bucket) => {
        // Convert bucket name to folder name (lowercase with hyphens)
        const folderName = bucket.name.toLowerCase().replace(/\s+/g, '-');

        // Load image: /{folderName}/{folderName}.png
        const img = new Image();
        img.src = `/${folderName}/${folderName}.png`;
        await new Promise((resolve) => { img.onload = resolve; });

        // Load wang data: /{folderName}/{folderName}.txt
        const response = await fetch(`/${folderName}/${folderName}.txt`);
        const wangData: WangTileData = await response.json();

        // Build role-to-id lookup map for O(1) access
        const roleToId = buildRoleToIdMap(wangData);

        terrainAssets.set(bucket.terrainType, {
            image: img,
            wangData,
            roleToId
        });
    });

    await Promise.all(promises);
    return terrainAssets;
}
```

**Asset folder structure:**
```
/public/
  ├── shallow-water/
  │   ├── shallow-water.png  (512×64px)
  │   └── shallow-water.txt  (JSON metadata)
  ├── sand/
  │   ├── sand.png
  │   └── sand.txt
  ├── dirt/
  │   ├── dirt.png
  │   └── dirt.txt
  └── grass/
      ├── grass.png
      └── grass.txt
```

**Folder naming rules:**
- Lowercase only
- Spaces replaced with hyphens
- Example: "Shallow Water" → `shallow-water`

---

## 5. Two-Pass Rendering System

### Why Two Passes?

The two-pass system prevents "phantom terrain" from appearing in transitions:
- **Base layer**: Ensures every tile has a solid background
- **Transition layers**: Only draw terrain where it actually exists

### Pass 1: Base Layer (Role 15 Only)

**Renders the lowest terrain type as a full tile** (from [src/main.ts:413-431](src/main.ts#L413-L431)):

```typescript
function renderBaseLayer(
    ctx: CanvasRenderingContext2D,
    grid: DualGridSystem,
    terrainAssets: Map<TerrainType, TerrainAssets>
): void {
    for (let y = 0; y < grid.height - 1; y++) {
        for (let x = 0; x < grid.width - 1; x++) {
            // Sample the 4 corners
            const tl = grid.getCell(x, y);
            const tr = grid.getCell(x + 1, y);
            const bl = grid.getCell(x + 1, y + 1);
            const br = grid.getCell(x, y + 1);

            // Draw the LOWEST terrain type as the base
            const minTerrain = Math.min(tl, tr, bl, br) as TerrainType;

            // Calculate screen position
            const { drawX, drawY } = calculateTilePosition(x, y);

            // Always use role 15 (full tile) for base layer
            drawTileByRole(ctx, drawX, drawY, minTerrain, 15, terrainAssets);
        }
    }
}
```

**Why `Math.min(tl, tr, bl, br)`?**
- The base layer is the "background" for all transitions
- Using the minimum terrain ensures higher terrain can layer on top
- Example: If corners are [Water=0, Sand=1, Dirt=2, Dirt=2], base is Water (0)

**Why role 15?**
- Role 15 (binary 1111) represents all 4 corners matching
- It's a full, solid tile with no transparency
- Perfect for backgrounds

### Pass 2: Transition Layers (Roles 1-14)

**Renders partial tiles in priority order** (from [src/main.ts:433-471](src/main.ts#L433-L471)):

```typescript
function renderTransitionLayers(
    ctx: CanvasRenderingContext2D,
    grid: DualGridSystem,
    terrainAssets: Map<TerrainType, TerrainAssets>,
    buckets: TerrainBucket[]
): void {
    // Get transition layer order (skip first/lowest bucket)
    const transitionOrder = buckets.slice(1).map(b => b.terrainType);

    // Render each layer in order
    for (const currentLayer of transitionOrder) {
        for (let y = 0; y < grid.height - 1; y++) {
            for (let x = 0; x < grid.width - 1; x++) {
                // Sample the 4 corners
                const tl = grid.getCell(x, y);
                const tr = grid.getCell(x + 1, y);
                const bl = grid.getCell(x + 1, y + 1);
                const br = grid.getCell(x, y + 1);

                // Calculate role for this layer
                let role = 0;
                if (tl >= currentLayer) role |= 1;
                if (tr >= currentLayer) role |= 2;
                if (bl >= currentLayer) role |= 4;
                if (br >= currentLayer) role |= 8;

                // Skip if role is 0 (no corners) or 15 (full tile, already in base)
                if (role === 0 || role === 15) continue;

                // Calculate screen position
                const { drawX, drawY } = calculateTilePosition(x, y);

                // Draw the partial tile
                drawTileByRole(ctx, drawX, drawY, currentLayer, role, terrainAssets);
            }
        }
    }
}
```

**Layer ordering logic** (from [src/main.ts:282-285](src/main.ts#L282-L285)):
```typescript
function getTransitionLayerOrder(buckets: TerrainBucket[]): TerrainType[] {
    // Skip the first (lowest) bucket - it's always the base layer
    return buckets.slice(1).map(b => b.terrainType);
}
```

**Example with default buckets:**
```
Buckets: [Water, Sand, Dirt, Grass]
Base layer: Water (always role 15)
Transition layers (in order): Sand, Dirt, Grass
```

**Why skip role 0 and role 15?**
- **Role 0**: No corners match → nothing to draw for this layer
- **Role 15**: All corners match → already drawn in base layer (would be redundant)

### Drawing a Tile by Role

**Complete drawing function** (from [src/main.ts:694-710](src/main.ts#L694-L710)):
```typescript
function drawTileByRole(
    ctx: CanvasRenderingContext2D,
    drawX: number,
    drawY: number,
    terrainType: TerrainType,
    role: number,
    terrainAssets: Map<TerrainType, TerrainAssets>
): void {
    const assets = terrainAssets.get(terrainType);
    if (!assets) return;

    // Get tile ID from role
    const tileId = assets.roleToId.get(role);
    if (tileId === undefined) return;

    // Calculate source position in atlas
    const tilesPerRow = 8;
    const row = Math.floor(tileId / tilesPerRow);
    const col = tileId % tilesPerRow;
    const srcX = col * 64;  // TILE_WIDTH
    const srcY = row * 32;  // TILE_HEIGHT

    // Draw the tile
    ctx.drawImage(
        assets.image,
        srcX, srcY, 64, 32,    // Source rectangle
        drawX, drawY, 64, 32   // Destination rectangle
    );
}
```

### Complete Rendering Pipeline

**Full render function:**
```typescript
function renderMap(
    ctx: CanvasRenderingContext2D,
    grid: DualGridSystem,
    terrainAssets: Map<TerrainType, TerrainAssets>,
    buckets: TerrainBucket[]
): void {
    // Clear canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Pass 1: Base layer (role 15 full tiles)
    renderBaseLayer(ctx, grid, terrainAssets);

    // Pass 2: Transition layers (roles 1-14 partial tiles)
    renderTransitionLayers(ctx, grid, terrainAssets, buckets);
}
```

---

## 6. Phaser 3 Specific Implementation

### Asset Loading with Phaser's Loader

**In your Phaser scene's `preload()` method:**

```typescript
class GameScene extends Phaser.Scene {
    private buckets: TerrainBucket[] = DEFAULT_BUCKETS;

    preload(): void {
        // Load all terrain atlases
        this.buckets.forEach(bucket => {
            const folderName = bucket.name.toLowerCase().replace(/\s+/g, '-');
            const key = `terrain_${bucket.terrainType}`;

            // Load sprite sheet
            this.load.image(`${key}_atlas`, `/${folderName}/${folderName}.png`);

            // Load Wang metadata
            this.load.json(`${key}_wang`, `/${folderName}/${folderName}.txt`);
        });
    }

    create(): void {
        // Assets are now loaded and accessible via this.textures
        this.initializeTerrainSystem();
    }
}
```

### Custom Rendering vs Tilemap

**Option 1: Custom Rendering (Recommended)**

Use Phaser's graphics/sprite system to manually render tiles:

```typescript
class TerrainRenderer {
    private sprites: Phaser.GameObjects.Sprite[][] = [];
    private scene: Phaser.Scene;

    constructor(scene: Phaser.Scene, grid: DualGridSystem) {
        this.scene = scene;
        this.createSprites(grid);
    }

    private createSprites(grid: DualGridSystem): void {
        for (let y = 0; y < grid.height - 1; y++) {
            this.sprites[y] = [];
            for (let x = 0; x < grid.width - 1; x++) {
                const { drawX, drawY } = this.calculateIsometricPosition(x, y);
                const sprite = this.scene.add.sprite(drawX, drawY, '');
                sprite.setOrigin(0, 0);
                this.sprites[y][x] = sprite;
            }
        }
    }

    public updateTileSprite(
        x: number,
        y: number,
        terrainType: TerrainType,
        role: number,
        roleToId: Map<number, number>
    ): void {
        const sprite = this.sprites[y][x];
        const tileId = roleToId.get(role);
        if (tileId === undefined) return;

        const key = `terrain_${terrainType}_atlas`;
        sprite.setTexture(key);

        // Set frame based on tile ID position in atlas
        const { srcX, srcY } = this.getTilePosition(tileId);
        sprite.setCrop(srcX, srcY, 64, 32);
    }

    private calculateIsometricPosition(x: number, y: number): { drawX: number; drawY: number } {
        const centerX = x + 0.5;
        const centerY = y + 0.5;
        const drawX = (centerX - centerY) * 32; // TILE_WIDTH / 2
        const drawY = (centerX + centerY) * 16; // TILE_HEIGHT / 2
        return { drawX, drawY };
    }

    private getTilePosition(tileId: number): { srcX: number; srcY: number } {
        const tilesPerRow = 8;
        const row = Math.floor(tileId / tilesPerRow);
        const col = tileId % tilesPerRow;
        return {
            srcX: col * 64,
            srcY: row * 32
        };
    }
}
```

**Option 2: Phaser Tilemap (More Complex)**

Phaser's tilemap system expects a single tileset. You'd need to:
1. Combine all terrain atlases into one mega-tileset
2. Create a custom tile index mapping
3. Use Phaser's `putTileAt()` to place tiles

This is more complex and less flexible than custom rendering.

### Integrating with Phaser's Game Loop

**Complete Phaser scene example:**

```typescript
class GameScene extends Phaser.Scene {
    private grid!: DualGridSystem;
    private terrainAssets: Map<TerrainType, TerrainAssets> = new Map();
    private buckets: TerrainBucket[] = DEFAULT_BUCKETS;
    private renderer!: TerrainRenderer;

    preload(): void {
        // Load assets (see above)
        this.buckets.forEach(bucket => {
            const folderName = bucket.name.toLowerCase().replace(/\s+/g, '-');
            const key = `terrain_${bucket.terrainType}`;
            this.load.image(`${key}_atlas`, `/${folderName}/${folderName}.png`);
            this.load.json(`${key}_wang`, `/${folderName}/${folderName}.txt`);
        });
    }

    create(): void {
        // Initialize terrain system
        this.grid = new DualGridSystem(100, 100);

        // Build terrain assets map
        this.buckets.forEach(bucket => {
            const key = `terrain_${bucket.terrainType}`;
            const image = this.textures.get(`${key}_atlas`).getSourceImage() as HTMLImageElement;
            const wangData = this.cache.json.get(`${key}_wang`) as WangTileData;
            const roleToId = buildRoleToIdMap(wangData);

            this.terrainAssets.set(bucket.terrainType, {
                image,
                wangData,
                roleToId
            });
        });

        // Generate terrain
        const config: MapConfig = {
            scale: 0.015,
            seed: null, // Random
            size: 100,
            buckets: this.buckets
        };
        this.grid.generatePerlinMap(config);

        // Create renderer
        this.renderer = new TerrainRenderer(this, this.grid);

        // Render the map
        this.renderMap();
    }

    private renderMap(): void {
        // Pass 1: Base layer
        for (let y = 0; y < this.grid.height - 1; y++) {
            for (let x = 0; x < this.grid.width - 1; x++) {
                const tl = this.grid.getCell(x, y);
                const tr = this.grid.getCell(x + 1, y);
                const bl = this.grid.getCell(x + 1, y + 1);
                const br = this.grid.getCell(x, y + 1);
                const minTerrain = Math.min(tl, tr, bl, br) as TerrainType;

                const assets = this.terrainAssets.get(minTerrain)!;
                this.renderer.updateTileSprite(x, y, minTerrain, 15, assets.roleToId);
            }
        }

        // Pass 2: Transition layers
        const transitionOrder = this.buckets.slice(1).map(b => b.terrainType);
        for (const currentLayer of transitionOrder) {
            for (let y = 0; y < this.grid.height - 1; y++) {
                for (let x = 0; x < this.grid.width - 1; x++) {
                    const tl = this.grid.getCell(x, y);
                    const tr = this.grid.getCell(x + 1, y);
                    const bl = this.grid.getCell(x + 1, y + 1);
                    const br = this.grid.getCell(x, y + 1);

                    let role = 0;
                    if (tl >= currentLayer) role |= 1;
                    if (tr >= currentLayer) role |= 2;
                    if (bl >= currentLayer) role |= 4;
                    if (br >= currentLayer) role |= 8;

                    if (role === 0 || role === 15) continue;

                    const assets = this.terrainAssets.get(currentLayer)!;
                    this.renderer.updateTileSprite(x, y, currentLayer, role, assets.roleToId);
                }
            }
        }
    }

    // For regenerating the map
    public regenerateMap(seed?: number): void {
        const config: MapConfig = {
            scale: 0.015,
            seed: seed ?? null,
            size: 100,
            buckets: this.buckets
        };
        this.grid.generatePerlinMap(config);
        this.renderMap();
    }
}
```

### Performance Optimization Tips

**1. Use Render Textures for Static Terrain:**
```typescript
// Render entire map to a single texture (one-time cost)
const renderTexture = this.add.renderTexture(0, 0, mapWidth, mapHeight);
renderTexture.draw(terrainSprites);
renderTexture.saveTexture('generatedMap');

// Now use the texture for the game
const mapImage = this.add.image(0, 0, 'generatedMap');
```

**2. Cull Off-Screen Tiles:**
```typescript
// Only render tiles visible in camera
const camera = this.cameras.main;
const visibleBounds = camera.worldView;

for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
        const { drawX, drawY } = this.calculateIsometricPosition(x, y);
        if (visibleBounds.contains(drawX, drawY)) {
            // Render this tile
        }
    }
}
```

**3. Use Object Pooling for Sprites:**
```typescript
// Pre-create sprite pool
const spritePool: Phaser.GameObjects.Sprite[] = [];
for (let i = 0; i < maxTiles; i++) {
    const sprite = this.add.sprite(0, 0, '');
    sprite.setVisible(false);
    spritePool.push(sprite);
}

// Reuse sprites when rendering
spritePool[index].setTexture(key);
spritePool[index].setPosition(x, y);
spritePool[index].setVisible(true);
```

**4. Batch Rendering by Terrain Type:**
```typescript
// Group tiles by terrain type to minimize texture swaps
const tilesByTerrain = new Map<TerrainType, Array<{ x: number; y: number; role: number }>>();

// Collect all tiles first
for (let y = 0; y < grid.height - 1; y++) {
    for (let x = 0; x < grid.width - 1; x++) {
        // ... calculate role ...
        const tiles = tilesByTerrain.get(terrainType) || [];
        tiles.push({ x, y, role });
        tilesByTerrain.set(terrainType, tiles);
    }
}

// Render all tiles of same terrain type together
tilesByTerrain.forEach((tiles, terrainType) => {
    tiles.forEach(({ x, y, role }) => {
        // Render tile
    });
});
```

---

## 7. Complete Code Examples

### Minimal Working Implementation

**Complete TypeScript class ready for Phaser 3:**

```typescript
import { createNoise2D, NoiseFunction2D } from 'simplex-noise';

// ============================================================================
// ENUMS AND INTERFACES
// ============================================================================

enum TerrainType {
    Water = 0,
    Sand = 1,
    Dirt = 2,
    Grass = 3
}

interface TerrainBucket {
    name: string;
    color: string;
    threshold: number;
    terrainType: TerrainType;
}

interface MapConfig {
    scale: number;
    seed: number | null;
    size: number;
    buckets: TerrainBucket[];
}

interface WangTileMember {
    id: number;
    role: number;
}

interface WangTileData {
    tile_width: number;
    tile_height: number;
    wang_sets: Array<{
        members: WangTileMember[];
    }>;
}

interface TerrainAssets {
    image: HTMLImageElement;
    wangData: WangTileData;
    roleToId: Map<number, number>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;

const DEFAULT_BUCKETS: TerrainBucket[] = [
    { name: 'Shallow Water', color: '#225588', threshold: -1.0, terrainType: TerrainType.Water },
    { name: 'Sand', color: '#eebb44', threshold: -0.2, terrainType: TerrainType.Sand },
    { name: 'Dirt', color: '#885533', threshold: 0.0, terrainType: TerrainType.Dirt },
    { name: 'Grass', color: '#44aa44', threshold: 0.3, terrainType: TerrainType.Grass }
];

// ============================================================================
// DUAL GRID SYSTEM CLASS
// ============================================================================

class DualGridSystem {
    public width: number;
    public height: number;
    public cells: TerrainType[];
    private buckets: TerrainBucket[] = [];
    private noise2D: NoiseFunction2D;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.cells = new Array(width * height).fill(TerrainType.Water);
        this.noise2D = createNoise2D();
    }

    public getCell(x: number, y: number): TerrainType {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return TerrainType.Water;
        }
        return this.cells[y * this.width + x];
    }

    public setCell(x: number, y: number, type: TerrainType): void {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.cells[y * this.width + x] = type;
        }
    }

    public generatePerlinMap(config: MapConfig): void {
        this.buckets = [...config.buckets];
        const scale = config.scale;
        const seed = config.seed !== null ? config.seed : Math.random() * 1000;

        // Sort buckets by threshold (highest to lowest) for easier checking
        const sortedBuckets = [...config.buckets].sort((a, b) => b.threshold - a.threshold);

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                // Get noise value between -1 and 1
                const value = this.noise2D((x + seed) * scale, (y + seed) * scale);

                // Find the appropriate bucket - check from highest threshold to lowest
                let type = sortedBuckets[sortedBuckets.length - 1].terrainType;
                for (const bucket of sortedBuckets) {
                    if (value >= bucket.threshold) {
                        type = bucket.terrainType;
                        break;
                    }
                }

                this.setCell(x, y, type);
            }
        }
    }

    public getTransitionLayerOrder(): TerrainType[] {
        // Skip the first (lowest) bucket - it's always the base layer
        return this.buckets.slice(1).map(b => b.terrainType);
    }

    public getBuckets(): TerrainBucket[] {
        return this.buckets;
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function buildRoleToIdMap(wangData: WangTileData): Map<number, number> {
    const roleToId = new Map<number, number>();
    if (wangData.wang_sets && wangData.wang_sets[0]) {
        wangData.wang_sets[0].members.forEach(member => {
            roleToId.set(member.role, member.id);
        });
    }
    return roleToId;
}

function calculateRole(
    tl: TerrainType,
    tr: TerrainType,
    bl: TerrainType,
    br: TerrainType,
    currentLayer: TerrainType
): number {
    let role = 0;
    if (tl >= currentLayer) role |= 1;
    if (tr >= currentLayer) role |= 2;
    if (bl >= currentLayer) role |= 4;
    if (br >= currentLayer) role |= 8;
    return role;
}

function getTilePosition(tileId: number): { srcX: number; srcY: number } {
    const tilesPerRow = 8;
    const row = Math.floor(tileId / tilesPerRow);
    const col = tileId % tilesPerRow;
    return {
        srcX: col * TILE_WIDTH,
        srcY: row * TILE_HEIGHT
    };
}

function calculateIsometricPosition(x: number, y: number): { drawX: number; drawY: number } {
    const centerX = x + 0.5;
    const centerY = y + 0.5;
    const drawX = (centerX - centerY) * (TILE_WIDTH / 2);
    const drawY = (centerX + centerY) * (TILE_HEIGHT / 2);
    return { drawX, drawY };
}

// ============================================================================
// RENDERING FUNCTIONS
// ============================================================================

function drawTileByRole(
    ctx: CanvasRenderingContext2D,
    drawX: number,
    drawY: number,
    terrainType: TerrainType,
    role: number,
    terrainAssets: Map<TerrainType, TerrainAssets>
): void {
    const assets = terrainAssets.get(terrainType);
    if (!assets) return;

    const tileId = assets.roleToId.get(role);
    if (tileId === undefined) return;

    const { srcX, srcY } = getTilePosition(tileId);

    ctx.drawImage(
        assets.image,
        srcX, srcY, TILE_WIDTH, TILE_HEIGHT,
        drawX, drawY, TILE_WIDTH, TILE_HEIGHT
    );
}

function renderBaseLayer(
    ctx: CanvasRenderingContext2D,
    grid: DualGridSystem,
    terrainAssets: Map<TerrainType, TerrainAssets>,
    originX: number,
    originY: number
): void {
    for (let y = 0; y < grid.height - 1; y++) {
        for (let x = 0; x < grid.width - 1; x++) {
            const tl = grid.getCell(x, y);
            const tr = grid.getCell(x + 1, y);
            const bl = grid.getCell(x + 1, y + 1);
            const br = grid.getCell(x, y + 1);

            const minTerrain = Math.min(tl, tr, bl, br) as TerrainType;
            const { drawX, drawY } = calculateIsometricPosition(x, y);

            drawTileByRole(
                ctx,
                originX + drawX,
                originY + drawY,
                minTerrain,
                15,
                terrainAssets
            );
        }
    }
}

function renderTransitionLayers(
    ctx: CanvasRenderingContext2D,
    grid: DualGridSystem,
    terrainAssets: Map<TerrainType, TerrainAssets>,
    originX: number,
    originY: number
): void {
    const transitionOrder = grid.getTransitionLayerOrder();

    for (const currentLayer of transitionOrder) {
        for (let y = 0; y < grid.height - 1; y++) {
            for (let x = 0; x < grid.width - 1; x++) {
                const tl = grid.getCell(x, y);
                const tr = grid.getCell(x + 1, y);
                const bl = grid.getCell(x + 1, y + 1);
                const br = grid.getCell(x, y + 1);

                const role = calculateRole(tl, tr, bl, br, currentLayer);

                if (role === 0 || role === 15) continue;

                const { drawX, drawY } = calculateIsometricPosition(x, y);

                drawTileByRole(
                    ctx,
                    originX + drawX,
                    originY + drawY,
                    currentLayer,
                    role,
                    terrainAssets
                );
            }
        }
    }
}

function renderMap(
    ctx: CanvasRenderingContext2D,
    grid: DualGridSystem,
    terrainAssets: Map<TerrainType, TerrainAssets>,
    originX: number = 0,
    originY: number = 0
): void {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    renderBaseLayer(ctx, grid, terrainAssets, originX, originY);
    renderTransitionLayers(ctx, grid, terrainAssets, originX, originY);
}

// ============================================================================
// ASSET LOADING
// ============================================================================

async function loadTerrainAssets(
    buckets: TerrainBucket[]
): Promise<Map<TerrainType, TerrainAssets>> {
    const terrainAssets = new Map<TerrainType, TerrainAssets>();

    const promises = buckets.map(async (bucket) => {
        const folderName = bucket.name.toLowerCase().replace(/\s+/g, '-');

        const img = new Image();
        img.src = `/${folderName}/${folderName}.png`;
        await new Promise((resolve) => { img.onload = resolve; });

        const response = await fetch(`/${folderName}/${folderName}.txt`);
        const wangData: WangTileData = await response.json();

        const roleToId = buildRoleToIdMap(wangData);

        terrainAssets.set(bucket.terrainType, {
            image: img,
            wangData,
            roleToId
        });
    });

    await Promise.all(promises);
    return terrainAssets;
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

async function initializeTerrainSystem() {
    // Load assets
    const terrainAssets = await loadTerrainAssets(DEFAULT_BUCKETS);

    // Create grid
    const grid = new DualGridSystem(100, 100);

    // Generate terrain
    const config: MapConfig = {
        scale: 0.015,
        seed: null, // Random seed
        size: 100,
        buckets: DEFAULT_BUCKETS
    };
    grid.generatePerlinMap(config);

    // Render to canvas
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    renderMap(ctx, grid, terrainAssets, canvas.width / 2, 100);
}

// Export for use in other modules
export {
    TerrainType,
    TerrainBucket,
    MapConfig,
    WangTileData,
    TerrainAssets,
    DualGridSystem,
    DEFAULT_BUCKETS,
    buildRoleToIdMap,
    calculateRole,
    renderMap,
    loadTerrainAssets
};
```

### Usage in Phaser 3 Scene

```typescript
import Phaser from 'phaser';
import {
    DualGridSystem,
    TerrainAssets,
    TerrainType,
    DEFAULT_BUCKETS,
    MapConfig,
    buildRoleToIdMap,
    calculateRole
} from './DualGridSystem';

class GameScene extends Phaser.Scene {
    private grid!: DualGridSystem;
    private terrainAssets: Map<TerrainType, TerrainAssets> = new Map();

    constructor() {
        super({ key: 'GameScene' });
    }

    preload(): void {
        // Load all terrain assets
        DEFAULT_BUCKETS.forEach(bucket => {
            const folderName = bucket.name.toLowerCase().replace(/\s+/g, '-');
            const key = `terrain_${bucket.terrainType}`;
            this.load.image(`${key}_atlas`, `/${folderName}/${folderName}.png`);
            this.load.json(`${key}_wang`, `/${folderName}/${folderName}.txt`);
        });
    }

    create(): void {
        // Initialize grid
        this.grid = new DualGridSystem(100, 100);

        // Build terrain assets map
        DEFAULT_BUCKETS.forEach(bucket => {
            const key = `terrain_${bucket.terrainType}`;
            const image = this.textures.get(`${key}_atlas`).getSourceImage() as HTMLImageElement;
            const wangData = this.cache.json.get(`${key}_wang`);
            const roleToId = buildRoleToIdMap(wangData);

            this.terrainAssets.set(bucket.terrainType, {
                image,
                wangData,
                roleToId
            });
        });

        // Generate terrain
        this.generateNewMap();

        // Add UI for regenerating
        this.input.keyboard?.on('keydown-SPACE', () => {
            this.generateNewMap(Math.floor(Math.random() * 999999));
        });
    }

    private generateNewMap(seed?: number): void {
        const config: MapConfig = {
            scale: 0.015,
            seed: seed ?? null,
            size: 100,
            buckets: DEFAULT_BUCKETS
        };

        this.grid.generatePerlinMap(config);

        // Trigger re-render
        // (Implement your rendering logic here based on your chosen approach)
        console.log('Map generated with seed:', config.seed);
    }
}

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    scene: GameScene,
    backgroundColor: '#000000'
};

new Phaser.Game(config);
```

---

## Summary Checklist

When implementing this system in Phaser 3, ensure you:

- [ ] Install `simplex-noise` library
- [ ] Create the terrain bucket configuration at game load
- [ ] Implement the `DualGridSystem` class with proper cell storage
- [ ] **Critically important:** Use the correct isometric corner mapping (tl, tr, bl, br)
- [ ] Load all Wang tile JSON files and build role-to-id lookup maps
- [ ] Understand the bitmask calculation (`>=` comparison, not `==`)
- [ ] Implement two-pass rendering: base layer first, then transitions
- [ ] Skip role 0 (no corners) and role 15 (full tile) in transition layers
- [ ] Calculate tile positions correctly from the sprite atlas (8 tiles per row)
- [ ] Use isometric projection formula for screen positioning
- [ ] Test with different seeds to verify reproducibility
- [ ] Implement game logic queries (e.g., "is this tile grass?")

---

## Quick Reference

### File Locations in Original Codebase

| Component | File | Lines |
|-----------|------|-------|
| Terrain types enum | src/main.ts | 22-27 |
| Terrain bucket interface | src/main.ts | 35-42 |
| Default buckets | src/main.ts | 72-77 |
| DualGridSystem class | src/main.ts | 242-1079 |
| generatePerlinMap() | src/main.ts | 364-392 |
| render() method | src/main.ts | 394-625 |
| Base layer rendering | src/main.ts | 413-431 |
| Transition layer rendering | src/main.ts | 433-471 |
| Corner mapping | src/main.ts | 292-302 |
| Wang bitmask calculation | src/main.ts | 451-461 |
| Asset loading | src/main.ts | 104-154 |
| Tile atlas rendering | src/main.ts | 694-710 |

### Key Formulas

**Noise generation:**
```typescript
noise2D((x + seed) * scale, (y + seed) * scale)
```

**Corner sampling:**
```typescript
tl = grid[x, y], tr = grid[x+1, y], bl = grid[x+1, y+1], br = grid[x, y+1]
```

**Role calculation:**
```typescript
role = (tl >= layer ? 1 : 0) | (tr >= layer ? 2 : 0) | (bl >= layer ? 4 : 0) | (br >= layer ? 8 : 0)
```

**Isometric projection:**
```typescript
drawX = (x - y + 1) * (TILE_WIDTH / 2)
drawY = (x + y + 1) * (TILE_HEIGHT / 2)
```

**Atlas tile position:**
```typescript
srcX = (tileId % 8) * 64
srcY = Math.floor(tileId / 8) * 32
```

---

## Additional Resources

- **Simplex Noise Library**: https://www.npmjs.com/package/simplex-noise
- **Wang Tiles Explanation**: https://en.wikipedia.org/wiki/Wang_tile
- **Phaser 3 Documentation**: https://photonstorm.github.io/phaser3-docs/

Good luck with your Phaser 3 implementation! This system creates beautiful, procedurally generated terrain with smooth transitions.
