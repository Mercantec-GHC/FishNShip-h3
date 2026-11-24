# FishNShip

FishNShip lets you edit Arduino sketches, compile and upload firmware to a Portenta Machine Control, and monitor the warehouse over USB. Use English for all website content and project documentation, including new features.

## Run locally

From the repository root, run `dotnet run --project web/LagerDemo.csproj` with the .NET 10 SDK. Open [localhost:5080](http://localhost:5080/) in Chrome or Edge on the computer connected to the Portenta. Docker Desktop can also run the editor and browser-based monitoring with `docker compose up --build`.

## Monitor the physical warehouse

1. Open `Demo/Demo.ino` in Arduino IDE. Select **Arduino Portenta H7**, choose **Main Core**, install the `Arduino_PortentaMachineControl` library and upload the sketch.
2. Close Serial Monitor in Arduino IDE. In FishNShip, click **Select Arduino** and choose the USB port. Use **Reconnect** for a previously authorized device or **Disconnect** to release the port.
3. Read sketch output in **Serial Monitor**. The digital input table shows the raw DI0–DI7 levels. The sketch reports all eight inputs together every 200 ms at 115200 baud. The browser reads them using Web Serial. If reports stop or the port disconnects, the table shows **No reading**.

The sketch also reports AI0–AI2 in volts using the Portenta’s 0–10 V mode. Older digital-only sketches still work. Keep analog inputs within 0–10 V. **Never connect a +24 V OUT sensor supply directly to an analog input.** On the warehouse connector, terminals 9 and 10 carry the lower and upper track sensor signals (A1 and A2). Check the physical wiring to identify the corresponding Portenta channels.

## Edit, compile and upload

Open **Code and upload**. The C++ editor provides line numbers, Arduino completions, search and replace, and compiler diagnostics. **Save to project** (Ctrl+S) writes to `Demo/Demo.ino`. **Compile** (Ctrl+Enter) builds the current draft and streams compiler output. **Download .ino** downloads a copy, including on the hosted site.

For local uploads, run the .NET app directly on the computer connected to the board. Connect one Portenta H7, click **Find port**, close Arduino IDE’s Serial Monitor and choose **Upload to COM…** after compilation. FishNShip releases its serial connection during upload. Click **Reconnect** to monitor the updated sketch.

The local server uses Arduino CLI and the Portenta USB bootloader. On Windows it normally finds the CLI bundled with Arduino IDE. Set `Arduino__CliPath`, `Arduino__CliConfig` or `Arduino__SketchPath` to override the CLI, configuration or sketch path. Install Arduino Mbed OS Portenta Boards and Arduino_PortentaMachineControl in the selected CLI configuration.

## Hosted builds and uploads

Dokploy deploys `compose.dokploy.yml` from `main` and routes fishnship.mercantec.tech to container port 3000. The hosted app edits sketches, monitors USB through the browser and compiles for Portenta H7 (M7) using Arduino CLI inside Docker. The server runs one build at a time.

To upload on Windows without running the local server, compile on FishNShip, click **Download firmware package**, extract the entire ZIP and run `Upload.cmd` on the computer connected to the board. Confirm the detected COM port. The package includes the compiled firmware. The upload computer needs Arduino CLI and the Mbed Portenta board package.

To upload directly from the hosted editor:

1. Start the local .NET app on the computer connected to the board.
2. Open [FishNShip](https://fishnship.mercantec.tech/#firmware) in Chrome or Edge on that computer. Click **Find port** and authorize the connection in the local window. If pop-ups are blocked, choose **Connect with an upload code** and get the code from [the local tool](http://localhost:5080/#firmware).
3. Click **Build and upload to COM…**. Allow local network access if prompted. The browser sends the sketch to the local tool, which compiles and uploads it using Arduino CLI. The connection is stored in the tab. The code remains valid until the local server restarts.

## Explore the 3D warehouse

Open the [3D model](https://fishnship.mercantec.tech/three). Drag to rotate, scroll to zoom and select a part to inspect it. The demo shows a storage and retrieval cycle. Click a signal to view its trace. Use **Full screen with signal monitor** to keep the model and controls together.

Under **USB live**, connect the Portenta to see raw digital and analog readings. In **Map inputs**, match each digital channel to its physical warehouse terminal and active level. With the standard wiring, the inner and outer light barriers go low when interrupted. An active mapped sensor glows green on the model.

### Control the conveyor over USB

Upload the included Demo/Demo.ino sketch and open **USB live** on the 3D page. Connect the Portenta and use **Q1 · Forward 1 s** or **Q2 · Reverse 1 s** to jog the physical conveyor. **Stop** ends the jog early. These controls assume digital output 0 is wired to Q1 and output 1 to Q2.

The sketch starts with both outputs low, energizes one direction at a time and stops each jog locally after one second, including if the USB connection drops. It requires 250 ms at rest before accepting another jog. Input readings continue during motion. The panel and model show the output state reported by the sketch. Actual belt movement depends on the wiring and motor supply.

## Rebuild the frontend

After changing the CodeMirror editor, run `npm ci --prefix web/editor` and `npm run build --prefix web/editor` to regenerate its bundle and license notices. For model or animation changes, run `npm ci --prefix web/three` and `npm run build --prefix web/three`. Both bundles ship with the app and Docker image.

## Manufacturer documentation

- [fischertechnik 536631 data sheet and terminal list](https://fiproductmedia.azureedge.net/media/Certification%20Documents/Technical%20Datasheets/fischertechnik/TDB_536631-AUTOMATISIERTES_HOCHREGAL_24V.pdf)
- [Arduino Portenta Machine Control user manual](https://docs.arduino.cc/tutorials/portenta-machine-control/user-manual/)
