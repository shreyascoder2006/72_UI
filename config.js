/* Runtime configuration.

   mapboxToken  Set a Mapbox public token (pk.…) to render with Mapbox GL JS v3 on
                Mapbox Streets (dark-v11, restyled). Leave empty to use MapLibre GL JS
                on the OpenStreetMap tiles shipped in data/tiles.
   tiles        'auto' (baked tiles, falling back to live OpenFreeMap tiles when they
                cannot be fetched, e.g. from file://), 'local', or 'remote'.
   dataBase     Base URL for the data/ folder if it is hosted elsewhere.
   tileBundles  Set by tools/build_dist.py: path of the JSON index of base64 tile bundles
                used by single-page builds. Leave unset for the per-tile .pbf files. */
window.TWIN_CONFIG = Object.assign({
  mapboxToken: '',
  tiles: 'auto',
  dataBase: '',
}, window.TWIN_CONFIG || {});
