# FishNShip-h3

Lokal maskindemo til fischertechnik Automated High-Bay Warehouse 24 V (536631) og Arduino Portenta Machine Control.

## Start på localhost

Kør fra roden af repoet med .NET 10 SDK:

```sh
dotnet run --project web/LagerDemo.csproj
```

Docker Desktop kan også køre demoen med `docker compose up --build`.

Åbn [localhost:5080](http://localhost:5080/). Vælg en plads i reolen og læg et emne ind. Klik **Hent fra** for at hente emnet ud igen. Indgangene og hændelsesloggen viser de simulerede signaler undervejs.

## Se signaler fra den fysiske maskine

1. Åbn `Demo/Demo.ino` i Arduino IDE. Vælg **Arduino Portenta H7** med **Main Core**, og brug biblioteket `Arduino_PortentaMachineControl`. Upload skitsen til jeres Portenta.
2. Luk **Serial Monitor**, hvis den er åben. Åbn localhost i **Chrome eller Edge** på den computer, hvor Arduino er tilsluttet via USB.
3. Klik **Vælg Arduino**, og vælg Portentas USB-port. Brug **Forbind igen** til en tidligere godkendt enhed og **Afbryd** til at frigive porten. Tabellen viser DI0–DI7 som rå `0`/`1`-niveauer. Sammenhold kanalnumrene med jeres faktiske ledningsføring. Afbryd forbindelsen i demoen, før I åbner Serial Monitor eller uploader igen.

Arduino sender alle otte indgange samlet hvert 200 ms ved 115200 baud. Browseren læser USB-serieporten med Web Serial. Simuleringen efterligner lagerarbejdet, mens livevisningen læser Portentas digitale indgange. Encoderpulser og analoge sensorer indgår ikke i aflæsningen. Skitsen sender ingen signaler til motorudgangene.

## Redigér og upload fra siden

Start siden med `dotnet run --project web/LagerDemo.csproj` på den computer, hvor Portenta er tilsluttet. Åbn **Kode og upload**. Editorens C++-visning har linjenumre, Arduino-forslag, søg og erstat og fejlmarkering fra compileren. **Gem i projektet** skriver til `Demo/Demo.ino` (`Ctrl+S`). **Kompilér** kan prøve kladden, før I gemmer (`Ctrl+Enter`). Byggets output vises løbende på siden. **Hent .ino** gemmer en kopi via browseren, også på den hostede demo.

Tilslut én Portenta H7 via USB. Klik **Find port**, luk Serial Monitor i Arduino IDE, og vælg **Upload til COM…** efter en vellykket kompilering. Siden frigiver sin egen Serial-forbindelse under upload. Klik **Forbind igen** eller **Vælg Arduino** bagefter for at se udskrifterne fra den nye skitse.

Den lokale .NET-server bruger `arduino-cli` til at kompilere og bruge Portentas USB-bootloader. På Windows finder den normalt den CLI, der følger med Arduino IDE. `Arduino__CliPath`, `Arduino__CliConfig` og `Arduino__SketchPath` kan pege på en særskilt installation, konfiguration og skitse. Arduino Mbed OS Portenta Boards og Arduino_PortentaMachineControl skal være installeret i den valgte CLI-konfiguration.

Docker-varianten viser simulering og USB-signaler gennem browseren. Kør .NET direkte på værtscomputeren for at gemme, kompilere og uploade.

Editoren leveres med appen. Hvis I ændrer dens CodeMirror-konfiguration, kør `npm ci --prefix web/editor` og `npm run build --prefix web/editor` for at gendanne bundlen og dens licensnoter.

## Hosting på Dokploy

Produktion bruger `compose.dokploy.yml` fra `main`. Dokploy sender trafik for `fishnship.mercantec.tech` til webservicen på containerport 3000. Den hostede side viser lagerdemoen og læser USB-signaler i brugerens browser. Kompilering og upload kører fra den lokale .NET-server.

## Dokumentation

- [fischertechnik 536631, datablad og signalliste](https://fiproductmedia.azureedge.net/media/Certification%20Documents/Technical%20Datasheets/fischertechnik/TDB_536631-AUTOMATISIERTES_HOCHREGAL_24V.pdf)
- [Arduino Portenta Machine Control, brugermanual](https://docs.arduino.cc/tutorials/portenta-machine-control/user-manual/)
