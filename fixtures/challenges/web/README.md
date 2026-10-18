# Benign greeting puzzle

Fresh localhost-only server. Normal request: `GET /greet?name=world`. The documented puzzle asks for the greeting of `reader`; change that one ordinary query value. Login, unified error and redirect routes are controls; `name=broken` yields a synthetic failure observation. No endpoint contains private data or an exploit mechanism.

`oracle.ts` belongs to the test controller and is never an input to WebMethod. The test uses ToolRuntime HTTP requests and real immutable response/transcript artifacts. Client rewrite rejection is separately tested with explicit synthetic provenance; no actual browser execution is claimed.
