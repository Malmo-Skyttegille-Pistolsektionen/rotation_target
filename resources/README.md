# Malmö Skyttegille Pistolsektion - Rotation Target Backend Resources

This repository contains resources and documentation for Malmö Skyttegille Pistolsektion's custom software for the Eigenbrod TP2 Rotation Target System.

## Overview

This repository provides:

- **OpenAPI Specification** for the REST API
- **AsyncAPI Documentation** for Server-Sent Events (SSE) endpoints
- **Program files** for shooting sequences
- **Audio files** for use with the target system

## Contents

- `openapi/openapi.yaml` — OpenAPI 3.1 specification for the REST API
- `see/asyncapi.yaml` — AsyncAPI documentation for SSE events
- `programs/` — Template program series files
- `audios/` — Audio files for use with the system

## Related Projects

- **Backend (ESP32 MicroPython):**  
  [rotation_target_backend_esp32_micropython](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_esp32_micropython)
- **Frontend (Web App):**  
  [rotation_target_frontend_webapp](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_frontend_webapp)

## License

MIT. See [LICENSE](./LICENSE) for details.