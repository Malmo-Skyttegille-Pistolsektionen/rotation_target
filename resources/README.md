# Malmö Skyttegille Pistolsektion - Rotation Target Backend Resources

This repository contains resources and documentation for Malmö Skyttegille Pistolsektion's custom software for the Eigenbrod TP2 Rotation Target System.

## Overview

This repository provides:

- **Program files** for shooting sequences
- **Audio files** for use with the target system

The API specifications used to live here. They are now in
[`../contracts/`](../contracts/README.md), which is canonical, alongside the
program document schema these files are validated against.

## Contents

- `programs/` — Template program series files, plus `validate_programs.sh`
- `audios/` — Audio files for use with the system

## Related Projects

- **Backend (ESP32 MicroPython):**  
  [rotation_target_backend_esp32_micropython](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_esp32_micropython)
- **Frontend (Web App):**  
  [rotation_target_frontend_webapp](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_frontend_webapp)

## License

MIT. See [LICENSE](./LICENSE) for details.