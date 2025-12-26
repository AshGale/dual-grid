# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a single-file isometric terrain renderer that demonstrates dual-grid tile mapping with Perlin noise generation. The entire application is contained in [index.html](index.html) and runs directly in the browser without a build step.

## Architecture

### Dual Grid System

The core concept is a **dual grid** approach where each rendered tile is determined by the terrain types of its four corner cells:

- **Data Grid**: A 30x30 array of terrain type values (Water, Sand, Dirt, Grass)
- **Render Grid**: Each rendered tile samples 4 neighboring cells (TL, TR, BL, BR) to determine which tile variant to draw

This creates smooth terrain transitions where tiles automatically blend based on their neighbors, similar to Wang tiling or blob tiling systems.

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

### Rendering

The renderer uses actual sprite textures loaded from `/public/` with Wang tiling:
- Each terrain type has 15 tile variants based on corner matching
- Tiles are drawn in layers to ensure proper visual stacking
- Wang tile role is calculated using bitmask: TL=1, TR=2, BL=4, BR=8
