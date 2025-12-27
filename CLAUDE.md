# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a single-file isometric terrain renderer that demonstrates dual-grid tile mapping with Perlin noise generation. The entire application is contained in [index.html](index.html) and runs directly in the browser without a build step.

## Architecture

### Dual Grid System

The core concept is a **dual grid** approach where each rendered tile is determined by the terrain types of its four corner cells:

- **Data Grid**: A 30x30 array of terrain type values (Water, Sand, Dirt, Grass)
- **Render Grid**: Each rendered tile samples 4 neighboring cells to determine which tile variant to draw

This creates smooth terrain transitions where tiles automatically blend based on their neighbors, similar to Wang tiling or blob tiling systems.

#### Critical: Isometric Corner Mapping

**IMPORTANT**: In isometric view, the visual corners map to grid positions differently than in orthographic view. For a dual-grid tile at position `(x, y)`:

**Visual Corner → Grid Position Mapping:**
- **Top (North)** → grid position `(x, y)`
- **Right (East)** → grid position `(x+1, y)`
- **Bottom (South)** → grid position `(x+1, y+1)`
- **Left (West)** → grid position `(x, y+1)`

This mapping MUST be used consistently across:
- Base layer rendering ([src/main.ts:265-276](src/main.ts))
- Transition layer rendering ([src/main.ts:293-303](src/main.ts))
- Debug info generation ([src/main.ts:170-173](src/main.ts))
- Debug visualization dots ([src/main.ts:442-446](src/main.ts))

**Corner Variable Naming:**
- `tl` = Top visual corner (North)
- `tr` = Right visual corner (East)
- `bl` = Bottom visual corner (South)
- `br` = Left visual corner (West)

### Coordinate Systems

The renderer supports two projection modes (toggled via UI):

1. **Isometric Mode** (default): Uses diamond-shaped tiles with the projection formula:
   - `drawX = originX + (x - y) * (TILE_WIDTH / 2)`
   - `drawY = originY + (x + y) * (TILE_HEIGHT / 2)`
   - Standard 2:1 ratio tiles (64px wide × 32px tall)

2. **Top-Down Mode**: Orthogonal grid for debugging (40px squares split into 4 quadrants)

### Tile Assets

The `/water/`, `/sand/`, `/dirt/`, and `/grass/` directories contain:
- `*.png` - Isometric tile sprites (64×32px each)
- `*.txt` - Wang tile metadata defining the 15 tile variants per terrain type

Wang tile roles (corner bitmask):
- 0-15 representing all possible combinations of matching/non-matching corners
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
- `TILE_WIDTH = 64`: Isometric tile width
- `TILE_HEIGHT = 32`: Isometric tile height (half of width for 2:1 ratio)
- `GRID_SIZE = 30`: Data grid dimensions (30×30 cells)

### Terrain Generation

Perlin noise parameters in `generatePerlinMap()`:
- `scale = 0.08`: Noise frequency (lower = larger landmasses)
- Threshold values map noise (-1 to 1) to terrain types:
  - `< -0.2`: Water
  - `-0.2 to 0.0`: Sand
  - `0.0 to 0.3`: Dirt
  - `> 0.3`: Grass

## Code Structure

The main class is `DualGridSystem` which handles:
- Terrain data storage and access
- Perlin noise map generation
- Dual-grid tile rendering logic with proper layering (Water → Sand → Dirt → Grass)
- Projection mode switching (Isometric ↔ Top-down)
- Camera offset for panning the map

### Controls

- **Mouse drag**: Pan/scroll the map by clicking and dragging
- **New Random Map button**: Regenerate terrain with new Perlin noise
- **Toggle Isometric button**: Switch between isometric and top-down view

### Rendering System

The renderer uses a **two-pass rendering system** with Wang tiling for smooth terrain transitions:

#### Pass 1: Base Layer
- Draws the **lowest terrain type** from the 4 corners as a full tile (role 15) background
- Example: If corners are Water, Water, Dirt, Dirt → draws Water as base
- This ensures every tile has a solid background for transitions to layer on top

#### Pass 2: Transition Layers
- Draws partial tiles in priority order: Sand → Dirt → Grass
- Each layer only draws where its terrain **actually exists** at the corners
- Skips role 0 (no corners) and role 15 (full tiles, already in base layer)
- This prevents phantom intermediate terrain from appearing

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

**Solution**: Verify debug dots array at [src/main.ts:442-446](src/main.ts) uses correct mapping.
