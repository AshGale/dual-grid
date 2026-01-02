# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an isometric terrain renderer that demonstrates dual-grid tile mapping with Perlin noise generation. Built with Vite and TypeScript, it features interactive debugging tools, configurable map generation, and multiple visualization modes.

## Architecture

### Dual Grid System

The core concept is a **dual grid** approach where each rendered tile is determined by the terrain types of its four corner cells:

- **Data Grid**: A configurable grid (default 100x100) of terrain type values
- **Render Grid**: Each rendered tile samples 4 neighboring cells to determine which tile variant to draw

This creates smooth terrain transitions where tiles automatically blend based on their neighbors, similar to Wang tiling or blob tiling systems.

The system supports **dynamic terrain buckets** - you can configure any number of terrain types with custom names, colors, thresholds, and textures through the configuration panel.

#### Critical: Isometric Corner Mapping

**IMPORTANT**: In isometric view, the visual corners map to grid positions differently than in orthographic view. For a dual-grid tile at position `(x, y)`:

**Visual Corner → Grid Position Mapping:**
- **Top (North)** → grid position `(x, y)`
- **Right (East)** → grid position `(x+1, y)`
- **Bottom (South)** → grid position `(x+1, y+1)`
- **Left (West)** → grid position `(x, y+1)`

This mapping MUST be used consistently across:
- Base layer rendering (around [src/main.ts:420-425](src/main.ts))
- Transition layer rendering (around [src/main.ts:448-451](src/main.ts))
- Debug info generation (around [src/main.ts:301-304](src/main.ts))
- Debug visualization dots (around [src/main.ts:591-595](src/main.ts))

**Corner Variable Naming:**
- `tl` = Top visual corner (North)
- `tr` = Right visual corner (East)
- `bl` = Bottom visual corner (South)
- `br` = Left visual corner (West)

### Coordinate Systems and Render Modes

The renderer supports three projection modes (toggled via UI):

1. **Isometric Textured Mode** (default): Uses diamond-shaped tiles with textured sprites
   - Projection formula: `drawX = originX + (x - y) * (TILE_WIDTH / 2)` and `drawY = originY + (x + y) * (TILE_HEIGHT / 2)`
   - Standard 2:1 ratio tiles (64px wide × 32px tall)
   - Renders actual terrain sprite assets with Wang tiling

2. **Isometric Colored Mode**: Same isometric projection but with solid colors
   - Uses the same diamond-shaped projection as textured mode
   - Renders each terrain type as a solid color for quick visualization
   - Useful for debugging terrain generation without texture complexity

3. **Orthographic Colored Mode**: Top-down view for debugging
   - Orthogonal grid (40px squares split into 4 quadrants)
   - Each quadrant represents a corner of the dual-grid tile
   - Useful for understanding the dual-grid system and corner relationships

### Tile Assets

Terrain assets are organized in `/public/` with one folder per terrain type. Current available terrains include:
- `/shallow-water/` - Light blue water terrain
- `/deep-water/` - Dark blue water terrain
- `/sand/` - Sandy beach terrain
- `/dirt/` - Brown dirt terrain
- `/dirt-grass/` - Dirt mixed with grass
- `/grass/` - Green grass terrain
- `/forest-floor/` - Forest ground terrain
- `/stones/` - Rocky stone terrain
- `/muddy-grass/` - Muddy grass terrain

Each terrain folder contains:
- `<name>.png` - Isometric tile sprite atlas (512×64px: 8 tiles per row, 2 rows, 64×32px each)
- `<name>.txt` - Wang tile metadata JSON defining the 15 tile variants per terrain type

**Folder Naming Convention:**
- Folder names must be lowercase with hyphens replacing spaces
- Example: "Shallow Water" → `/shallow-water/`
- The asset loading system automatically converts bucket names using `.toLowerCase().replace(/\s+/g, '-')`

Wang tile roles (corner bitmask):
- Roles 1-15 representing all possible combinations of matching/non-matching corners
- Role 0 (no corners) is skipped during rendering
- Used to select the correct tile variant based on neighboring terrain

## Development

### Running the Application

This project uses Vite for development and building.

**Development server:**
```bash
npm run dev
```

**Build for production:**
```bash
npm run build
```

**Preview production build:**
```bash
npm run preview
```

### Technology Stack

- **Vite**: Fast development server and build tool
- **TypeScript**: Proper TypeScript compilation (no in-browser transpilation)
- **SimplexNoise**: Perlin noise generation library (v4.0+)
- **Canvas API**: Direct 2D rendering with `image-rendering: pixelated` for crisp pixel art

### Project Structure

- `/src/main.ts` - Main application code
- `/public/` - Static assets (terrain sprites and Wang tile metadata)
- `/index.html` - Entry point HTML file

### Key Constants

Located at the top of [src/main.ts](src/main.ts):
- `TILE_WIDTH = 64`: Isometric tile width (configurable via comments for future UI support)
- `TILE_HEIGHT = 32`: Isometric tile height (half of width for 2:1 ratio)
- `GRID_SIZE = 100`: Default data grid dimensions (100×100 cells, configurable in UI)

### Terrain Generation

The system uses **Simplex noise** (not Perlin) for terrain generation with configurable parameters:

**Default Terrain Buckets** (defined in `DEFAULT_BUCKETS`):
- `Shallow Water`: threshold -1.0, color #225588 (TerrainType.Water = 0)
- `Sand`: threshold -0.2, color #eebb44 (TerrainType.Sand = 1)
- `Dirt`: threshold 0.0, color #885533 (TerrainType.Dirt = 2)
- `Grass`: threshold 0.3, color #44aa44 (TerrainType.Grass = 3)

**Noise Scale Configuration:**
The scale is split into three components (configurable in UI):
- **Macro scale**: Large-scale continent formation (0-1.00, step 0.01)
- **Mid scale**: Medium-scale terrain features (0-0.100, step 0.001)
- **Micro scale**: Fine-detail noise (0-0.0100, step 0.0001)
- **Total scale**: Sum of all three (default: 0.015)

**Bucket System:**
- Terrain buckets are sorted by threshold and checked from highest to lowest
- Noise values (-1 to 1) are compared against thresholds to determine terrain type
- Users can add/remove buckets and customize names, colors, thresholds, and textures dynamically
- Each bucket maps to a `TerrainType` enum value for asset loading

## Code Structure

### Main Types

**TerrainType enum:**
```typescript
enum TerrainType {
    Water = 0,
    Sand = 1,
    Dirt = 2,
    Grass = 3
}
```

**RenderMode enum:**
```typescript
enum RenderMode {
    IsometricTextured = 0,  // Isometric with sprite textures
    IsometricColored = 1,   // Isometric with solid colors
    OrthographicColored = 2 // Top-down with colored quadrants
}
```

**MapConfig interface:**
```typescript
interface MapConfig {
    scale: number;           // Combined noise scale (sum of macro/mid/micro)
    seed: number | null;     // Optional seed for reproducibility
    size: number;            // Grid dimensions (size × size)
    buckets: TerrainBucket[]; // Array of terrain bucket configurations
}
```

**TerrainBucket interface:**
```typescript
interface TerrainBucket {
    name: string;              // Display name (e.g., "Shallow Water")
    color: string;             // Hex color for rendering (e.g., "#225588")
    threshold: number;         // Minimum noise value (-1.0 to 1.0)
    terrainType: TerrainType;  // Maps to asset loading
    customTexture?: File;      // Optional custom texture upload
    customTextureLoaded?: boolean; // Track if custom texture is loaded
}
```

### DualGridSystem Class

The main class which handles:
- Terrain data storage and access
- Simplex noise map generation with configurable parameters and dynamic buckets
- Dual-grid tile rendering logic with proper layering (dynamically determined by bucket order)
- Projection mode switching between three render modes
- Camera offset for panning the map
- Zoom level for scaling the view (default: 1.0)
- Debug tile selection and info generation
- Layer visibility controls (base layer, transition layer, world grid, dual grid)
- Minimap rendering with viewport indicators
- Export to PNG image functionality

**Key Methods:**
- `generatePerlinMap(config: MapConfig)`: Generates terrain using Simplex noise and bucket thresholds
- `render(ctx, canvasWidth, canvasHeight)`: Main rendering loop with zoom transformation
- `getDebugInfo(x, y)`: Returns detailed tile information for debug panel
- `renderMinimap(ctx, width, height, canvasWidth, canvasHeight)`: Renders minimap with viewport indicator
- `exportToImage()`: Exports the full map as a PNG (with size limits to prevent browser crashes)

### Controls

**Mouse Interaction:**
- **Click and drag**: Pan/scroll the map
- **Click tile**: Select a tile and open the debug panel with detailed information

**Buttons:**
- **New Random Map**: Regenerate terrain with new Simplex noise and random seed
- **Export Map**: Export the current map as a PNG image (with size validation)
- **Textured / Colored / Ortho**: Switch between the three render modes (active button highlighted)
- **Config**: Open the configuration panel to adjust map generation parameters
- **Minimap**: Toggle the minimap overlay (shows by default)

**Keyboard Shortcuts:**
- **M key**: Toggle minimap visibility

**Checkboxes:**
- **Base Layer**: Toggle visibility of the base layer (role 15 full tiles)
- **Transition Layer**: Toggle visibility of transition layers (partial tiles)
- **World Grid**: Toggle overlay showing cell boundaries
- **Dual Grid**: Toggle overlay showing dual-grid tile boundaries

### Rendering System

The renderer uses a **two-pass rendering system** with Wang tiling for smooth terrain transitions:

#### Pass 1: Base Layer
- Draws the **lowest terrain type** from the 4 corners as a full tile (role 15) background
- Example: If corners are Water, Water, Dirt, Dirt → draws Water as base
- This ensures every tile has a solid background for transitions to layer on top

#### Pass 2: Transition Layers
- Draws partial tiles in **dynamic priority order** based on bucket configuration
- Default order: Sand → Dirt → Grass (determined by bucket array order, skipping first/lowest bucket)
- Each layer only draws where its terrain **actually exists** at the corners
- Skips role 0 (no corners) and role 15 (full tiles, already in base layer)
- This prevents phantom intermediate terrain from appearing
- Order is determined by `getTransitionLayerOrder()` which skips the base (lowest) bucket

#### Wang Tile Bitmask System

**Corner-to-Bit Mapping:**
- **Bit 1** = Top (tl) visual corner
- **Bit 2** = Right (tr) visual corner
- **Bit 4** = Bottom (bl) visual corner
- **Bit 8** = Left (br) visual corner

**Role Calculation:**
```typescript
let role = 0;
if (tl >= currentLayer) role |= 1;  // Top
if (tr >= currentLayer) role |= 2;  // Right
if (bl >= currentLayer) role |= 4;  // Bottom
if (br >= currentLayer) role |= 8;  // Left
```

**Display Format** (in `formatBitmask()`):
- Bit 1 displays as "TR" (Top-Right in traditional grid naming)
- Bit 2 displays as "BR" (Bottom-Right)
- Bit 4 displays as "BL" (Bottom-Left)
- Bit 8 displays as "TL" (Top-Left)

Each terrain type has 15 tile variants (roles 1-15) based on corner matching, loaded from `/public/` sprite sheets.

## Features

### Zoom System

The renderer includes a zoom system that scales the entire map:
- Zoom level is stored in `DualGridSystem.zoomLevel` (default: 1.0)
- Applied via canvas transform: `ctx.scale(zoomLevel, zoomLevel)`
- Transform is centered on the viewport center to zoom toward the middle of the screen
- Affects all rendering including tiles, grids, and debug overlays

### Minimap

An interactive minimap shows a bird's-eye view of the entire terrain:
- Located in bottom-right corner (toggle with "Minimap" button or M key)
- Shows the full map with color-coded terrain types
- Displays a viewport indicator showing what portion of the map is currently visible:
  - **Yellow rectangle** in orthographic mode
  - **Yellow diamond** in isometric mode
- Viewport indicator adjusts for both camera offset and zoom level
- Canvas size: 250×250 pixels
- Terrain colors are dynamically pulled from current bucket configuration
- See [src/main.ts:941-1080](src/main.ts) for implementation

**Viewport Calculation:**
- Orthographic mode: Simple rectangle based on canvas dimensions and tile size
- Isometric mode: Diamond shape calculated using inverse isometric transformation
- Both account for camera offset and zoom level to accurately show visible area

### Configuration Panel

Advanced map generation settings accessible via the "Config" button:

**Scale Control (Multi-slider System):**
- **Macro slider** (0-1.00, step 0.01): Controls large-scale continent formation
- **Mid slider** (0-0.100, step 0.001): Controls medium-scale terrain features
- **Micro slider** (0-0.0100, step 0.0001): Controls fine-detail noise
- **Total scale**: Sum of all three sliders, displayed with 5 decimal precision
- Default: 0.08 total (customizable per layer)

**Map Size:**
- Adjustable from 1×1 to 500×500 grid cells
- Default: 100×100
- Changing size creates a new `DualGridSystem` instance with all settings preserved

**Terrain Buckets (Dynamic Configuration):**
- **Add Bucket** button: Create new terrain types dynamically
- Each bucket has:
  - **Color preview**: Visual indicator of the terrain color
  - **Name input**: Terrain display name (converted to folder name via lowercase + hyphens)
  - **Threshold input**: Noise value threshold (-1.0 to 1.0, step 0.1)
  - **Color picker**: Choose terrain color
  - **Texture button**: Upload custom Wang tile texture (PNG, 512×64px recommended)
  - **Remove button**: Delete bucket (disabled if only 1 bucket remains)
- Buckets are sorted by threshold and determine terrain generation order
- Custom textures use the standard Wang tile mapping (same as built-in terrains)
- Changes update the live preview minimap in real-time

**Collapsible Sections:**
- **Map Generation**: Scale sliders, map size, and seed controls
- **Terrain Buckets**: Dynamic bucket management (add/edit/remove terrains)

**Seed Control:**
- Optional numeric seed for reproducible maps
- Leave empty for random generation
- "Random Seed" button generates a random 6-digit number

**Apply Behavior:**
- Validates inputs (size 1-500, seed must be numeric or empty)
- Rebuilds grid if size changed
- Regenerates terrain with new bucket configuration
- Updates global `currentBuckets` array
- Closes panel automatically after applying

**Panel Features:**
- Resizable via drag handle on the left edge (250-600px width)
- Live preview minimap shows map changes as you adjust settings
- Separate preview grid instance for performance

See [src/main.ts:1562-1920](src/main.ts) for full implementation.

### Debug System

#### Interactive Tile Selection

Click any tile to select it and view detailed debug information:
- Selected tile highlighted with cyan outline
- Red dots mark the four corner cells
- Debug panel automatically opens with tile information

#### Debug Panel

Comprehensive tile information displayed in a sliding panel:

**Tile Position:**
- Grid coordinates (x, y)
- Unique terrain count (warns if 3+ types, indicating complex transitions)

**Corner Terrain Types:**
- Top (North), Right (East), Bottom (South), Left (West)
- Color-coded by terrain type

**Base Layer:**
- Terrain type (lowest of 4 corners)
- Role: Always 15 (full tile)
- Tile ID from Wang data

**Transition Layers:**
- One section per terrain layer (dynamically determined by bucket configuration)
- Shows which layers are drawn vs. skipped
- Role bitmask with visual corner labels (TR/BR/BL/TL)
- Tile ID from Wang data
- Status explanation (drawn, skipped because no corners, or skipped because full tile)
- Drawn layers have blue border, skipped layers have gray border

**Panel Features:**
- Resizable via drag handle on the right edge (300-700px width)
- Auto-opens when clicking a tile
- Close button to dismiss

See [src/main.ts:289-364](src/main.ts) for debug info generation and [src/main.ts:1482-1560](src/main.ts) for display logic.

#### Debug Overlays

Two grid visualization modes (toggled via checkboxes):

**World Grid:**
- Shows cell boundaries of the data grid
- White semi-transparent lines
- In orthographic mode: Standard grid lines
- In isometric mode: Diamond shapes for each cell

**Dual Grid:**
- Shows tile boundaries of the render grid
- Yellow semi-transparent lines
- Each dual-grid tile is offset 0.5 in both x and y from cell grid
- In orthographic mode: Squares aligned with data grid
- In isometric mode: Diamonds centered between 4 corner cells

See [src/main.ts:476-554](src/main.ts) for implementation.

### Layer Visibility Controls

Toggle rendering of different layers for debugging:

**Base Layer:**
- When enabled: Draws role 15 full tiles using the lowest terrain type
- When disabled: Only transition layers are visible (creates a "see-through" effect)

**Transition Layer:**
- When enabled: Draws role 1-14 partial transition tiles
- When disabled: Only base layer is visible (all tiles become full squares/diamonds)

Both can be disabled simultaneously to show only overlays and debug indicators.

## Common Issues & Troubleshooting

### Phantom Terrain Appearing

**Symptom**: Sand appears between Water and Dirt transitions where no Sand corners exist.

**Cause**: Incorrect corner mapping - the code is sampling the wrong grid positions for visual corners.

**Solution**: Verify the corner mapping in all rendering passes matches:
```typescript
const tl = this.getCell(x, y);          // Top visual corner
const tr = this.getCell(x + 1, y);      // Right visual corner
const bl = this.getCell(x + 1, y + 1);  // Bottom visual corner
const br = this.getCell(x, y + 1);      // Left visual corner
```

### Debug Panel Labels Don't Match Visual Corners

**Symptom**: Debug panel shows "BL BR" but visually the top corners have the terrain.

**Cause**: Incorrect bitmask display formatting in `formatBitmask()`.

**Solution**: Ensure the formatBitmask function maps bits to labels correctly:
- Bit 1 → "TR", Bit 2 → "BR", Bit 4 → "BL", Bit 8 → "TL"

### Red Debug Dots Don't Match Corner Labels

**Symptom**: Red dots appear at different corners than the labels indicate.

**Cause**: Debug visualization using incorrect grid-to-corner mapping.

**Solution**: Verify debug dots array at [src/main.ts:458-462](src/main.ts) uses correct mapping.

### Zoom Not Working / Canvas Transform Issues

**Symptom**: Zoom transformation doesn't apply, or rendering appears incorrect after zoom.

**Cause**: Missing `ctx.save()` at the start of render or misplaced `ctx.restore()` in the rendering flow.

**Solution**:
- Ensure `ctx.save()` is called at the very start of the `render()` method (around [src/main.ts:400](src/main.ts))
- The zoom transform is applied after save: translate → scale → translate back
- **CRITICAL**: There should be NO `ctx.restore()` call in the main render method anymore
- The `ctx.restore()` was incorrectly placed in `drawTileByRole()` and has been removed
- Zoom is maintained across the entire render pipeline without needing restore

### Export Size Limits

**Symptom**: Export fails with alert about map being too large.

**Cause**: Browser canvas size limitations (max 16384×16384px) or memory constraints (100 megapixels).

**Solution**:
- Check the estimated export dimensions shown in the error alert
- Reduce map size in configuration panel:
  - Isometric modes: recommended max ~200×200
  - Orthographic mode: recommended max ~250×250
- The `exportToImage()` method includes validation and will return `null` if limits are exceeded
- Consider exporting in orthographic mode for larger maps (smaller pixel dimensions)
