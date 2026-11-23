# FishNShip-h3

Arduino-værktøj til at redigere, kompilere og uploade kode til Portenta Machine Control og overvåge de digitale indgange via USB.

## Start på localhost

Kør fra roden af repoet med .NET 10 SDK:

```sh
dotnet run --project web/LagerDemo.csproj
```

Docker Desktop kan også køre editoren og overvågningen med `docker compose up --build`.

Åbn [localhost:5080](http://localhost:5080/). Siden åbner med kodeeditoren. Serial Monitor viser skitsens udskrifter, og tabellen viser DI0–DI7, så snart siden modtager en måling.

## Se signaler fra den fysiske maskine

1. Åbn `Demo/Demo.ino` i Arduino IDE. Vælg **Arduino Portenta H7** med **Main Core**, og brug biblioteket `Arduino_PortentaMachineControl`. Upload skitsen til jeres Portenta.
2. Luk **Serial Monitor**, hvis den er åben. Åbn localhost i **Chrome eller Edge** på den computer, hvor Arduino er tilsluttet via USB.
3. Klik **Vælg Arduino**, og vælg Portentas USB-port. Brug **Forbind igen** til en tidligere godkendt enhed og **Afbryd** til at frigive porten. Tabellen viser DI0–DI7 som rå `0`/`1`-niveauer. Sammenhold kanalnumrene med jeres faktiske ledningsføring.

Arduino sender alle otte indgange samlet hvert 200 ms ved 115200 baud. Browseren læser USB-serieporten med Web Serial. Ved afbrudt forbindelse eller ophør af målinger viser tabellen **Ingen måling**.

Skitsen sender også Portentas AI0–AI2 i volt med Portenta i 0–10 V-tilstand. En ældre skitse med kun DI0–DI7 virker stadig. Spændingen på AI skal ligge inden for 0–10 V. Klemmerne mærket +24 V OUT er sensorforsyning og må aldrig forbindes direkte til AI. På fischertechnik-lagerets stik er A1 og A2 sporsensorernes nederste og øverste signal på klemme 9 og 10. Kontrollér ledningsføringen for at finde ud af, hvilken sensor der ender på hver AI-kanal.

## Redigér og upload fra siden

Start siden med `dotnet run --project web/LagerDemo.csproj` på den computer, hvor Portenta er tilsluttet. Åbn **Kode og upload**. Editorens C++-visning har linjenumre, Arduino-forslag, søg og erstat og fejlmarkering fra compileren. **Gem i projektet** skriver til `Demo/Demo.ino` (`Ctrl+S`). **Kompilér** kan prøve kladden, før I gemmer (`Ctrl+Enter`). Byggets output vises løbende på siden. **Hent .ino** gemmer en kopi via browseren, også på den hostede demo.

Tilslut én Portenta H7 via USB. Klik **Find port**, luk Serial Monitor i Arduino IDE, og vælg **Upload til COM…** efter en vellykket kompilering. Siden frigiver sin egen Serial-forbindelse under upload. Klik **Forbind igen** eller **Vælg Arduino** bagefter for at se udskrifterne fra den nye skitse.

Den lokale .NET-server bruger `arduino-cli` til at kompilere og bruge Portentas USB-bootloader. På Windows finder den normalt den CLI, der følger med Arduino IDE. `Arduino__CliPath`, `Arduino__CliConfig` og `Arduino__SketchPath` kan pege på en særskilt installation, konfiguration og skitse. Arduino Mbed OS Portenta Boards og Arduino_PortentaMachineControl skal være installeret i den valgte CLI-konfiguration.

Docker-varianten har editor og USB-overvågning i browseren. Kør .NET direkte på værtscomputeren for at gemme, kompilere og uploade.

Editoren leveres med appen. Hvis I ændrer dens CodeMirror-konfiguration, kør `npm ci --prefix web/editor` og `npm run build --prefix web/editor` for at gendanne bundlen og dens licensnoter.

## Hosting på Dokploy

Produktion bruger `compose.dokploy.yml` fra `main`. Dokploy sender trafik for `fishnship.mercantec.tech` til webservicen på containerport 3000. Den hostede side har kodeeditor og læser USB-signaler i brugerens browser. Kompilering og upload kører fra den lokale .NET-server.

## Dokumentation

- [fischertechnik 536631, datablad og signalliste](https://fiproductmedia.azureedge.net/media/Certification%20Documents/Technical%20Datasheets/fischertechnik/TDB_536631-AUTOMATISIERTES_HOCHREGAL_24V.pdf)
- [Arduino Portenta Machine Control, brugermanual](https://docs.arduino.cc/tutorials/portenta-machine-control/user-manual/)
