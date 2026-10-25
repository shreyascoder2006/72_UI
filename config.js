/* Runtime configuration.

   mapboxToken      Set a Mapbox public token (pk.…) to render with Mapbox GL JS v3 on the
                    Mapbox Standard style: Mapbox's own 3D buildings, landmarks and trees,
                    its light preset following the simulation clock, the palette pulled
                    toward the dark command-center look. Leave empty to use MapLibre GL JS
                    on the OpenStreetMap tiles shipped in data/tiles.
   tiles            'auto' (baked tiles, falling back to live OpenFreeMap tiles when they
                    cannot be fetched, e.g. from file://), 'local', or 'remote'.
   dataBase         Base URL for the data/ folder if it is hosted elsewhere.
   tileBundles      Set by tools/build_dist.py: path of the JSON index of base64 tile bundles
                    used by single-page builds. Leave unset for the per-tile .pbf files.
   modelBundles     Set by tools/build_dist.py: path of the JSON index of the hero models
                    packed as base64 (for hosts that will not serve .glb). Leave unset to
                    load data/models/*.glb.
   cityBuildings    MapLibre only. false keeps the style's flat-shaded fill-extrusion
                    buildings instead of the city-building renderer (facades, roofs, sun
                    shadows). The renderer also steps aside on its own without WebGL2 or
                    without local tiles.
   buildingShadows  false turns off the sun shadow map of the city-building renderer (the
                    biggest per-frame cost on slow GPUs).
   shadowSize       Shadow map size in texels. Default 4096, or 2048 on software
                    rasterisers (SwiftShader, llvmpipe). */
window.TWIN_CONFIG = Object.assign({
  mapboxToken: '',
  tiles: 'auto',
  dataBase: '',
  cityBuildings: true,
  buildingShadows: true,
}, window.TWIN_CONFIG || {});
