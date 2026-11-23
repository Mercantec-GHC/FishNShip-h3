using System.ComponentModel;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public sealed record SketchEdit(string? Code, string? Version, string? Port);

public sealed class FirmwareWorkspace(IWebHostEnvironment environment, IConfiguration configuration) : IDisposable
{
    private const string Board = "arduino:mbed_portenta:envie_m7";
    private const string BuildBoard = Board + ":split=50_50,target_core=cm7,security=none";
    private const int MaxSketchLength = 128 * 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly string scratch = Path.Combine(Path.GetTempPath(), "lager-firmware-" + Guid.NewGuid().ToString("N"));
    private readonly SemaphoreSlim operation = new(1, 1);
    private readonly Lock fileLock = new();
    private readonly bool enabled = configuration.GetValue("Arduino:Enabled", true);
    private readonly bool allowHostedCompile = configuration.GetValue("Arduino:AllowHostedCompile", false);
    private readonly string sourceFile = ResolveSketch(environment, configuration);
    private readonly string cli = ResolveCli(configuration);
    private readonly string? cliConfig = ResolveConfig(configuration);
    private string? compiledVersion;

    private string DraftFolder => Path.Combine(scratch, "Demo");
    private string BuildFolder => Path.Combine(scratch, "build");
    public bool AllowsHostedCompile => !enabled && allowHostedCompile;
    public bool LocalToolsEnabled => enabled;

    public object ReadSketch()
    {
        var code = File.ReadAllText(sourceFile);
        return new { code, version = VersionOf(code), enabled, compileEnabled = enabled || AllowsHostedCompile };
    }

    public IResult SaveSketch(SketchEdit edit)
    {
        if (!enabled) return Results.BadRequest(new { message = "Start siden med .NET på Arduino-computeren for at gemme i projektet." });
        if (!ValidCode(edit.Code)) return Results.BadRequest(new { message = "Skitsen mangler eller fylder for meget." });

        lock (fileLock)
        {
            if (VersionOf(File.ReadAllText(sourceFile)) != edit.Version)
                return Results.Conflict(new { message = "Demo.ino er ændret siden du åbnede siden. Kopiér dine ændringer og genindlæs filen." });

            var temp = sourceFile + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temp, edit.Code!);
                File.Move(temp, sourceFile, overwrite: true);
            }
            finally
            {
                File.Delete(temp);
            }
            return Results.Ok(new { version = VersionOf(edit.Code!) });
        }
    }

    public async Task<IResult> ListPorts(CancellationToken token)
    {
        if (!enabled) return Results.Ok(Array.Empty<string>());
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            return Results.Ok(await DetectPorts(timeout.Token));
        }
        catch (Exception ex) when (ex is InvalidOperationException or Win32Exception or JsonException or OperationCanceledException)
        {
            return Results.Problem(ex is Win32Exception ? "Arduino CLI blev ikke fundet." : "Kunne ikke finde Arduino-portene.", statusCode: 503);
        }
    }

    public async Task Run(HttpContext context, SketchEdit edit, bool upload)
    {
        context.Response.ContentType = "application/x-ndjson; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        var client = context.RequestAborted;
        using var writeLock = new SemaphoreSlim(1, 1);

        async Task Write(object entry)
        {
            await writeLock.WaitAsync();
            try
            {
                if (client.IsCancellationRequested) return;
                await context.Response.WriteAsync(JsonSerializer.Serialize(entry, Json) + "\n", client);
                await context.Response.Body.FlushAsync(client);
            }
            catch (Exception ex) when (ex is IOException || ex is OperationCanceledException && client.IsCancellationRequested)
            {
                // Let a firmware upload already in progress finish if the tab closes.
            }
            finally { writeLock.Release(); }
        }

        Task Finish(bool success, string message) => Write(new { success, message });
        var logLines = 0;
        Task Log(string line) =>
            line.Length <= 1800 && (!AllowsHostedCompile || Interlocked.Increment(ref logLines) <= 500)
                ? Write(new { line }) : Task.CompletedTask;

        var canRun = enabled || (!upload && AllowsHostedCompile);
        if (!canRun || !ValidCode(edit.Code))
        {
            await Finish(false, canRun ? "Skitsen mangler eller fylder for meget." : "Handlingen er kun tilgængelig på localhost.");
            return;
        }
        if (!operation.Wait(0))
        {
            await Finish(false, "Arduino CLI er allerede i gang med en kompilering eller upload.");
            return;
        }

        using var timeout = upload ? new CancellationTokenSource() : CancellationTokenSource.CreateLinkedTokenSource(client);
        timeout.CancelAfter(TimeSpan.FromMinutes(upload ? 2 : AllowsHostedCompile ? 3 : 8));
        DirectoryInfo? hostedBuild = null;
        try
        {
            var version = VersionOf(edit.Code!);
            if (upload)
            {
                if (compiledVersion != version || !File.Exists(Path.Combine(BuildFolder, "Demo.ino.bin")))
                {
                    await Finish(false, "Kompilér den aktuelle kode før upload.");
                    return;
                }

                await Log("Kontrollerer at Portenta stadig er tilsluttet…");
                var ports = await DetectPorts(timeout.Token);
                if (ports.Length != 1 || ports[0] != edit.Port)
                {
                    await Finish(false, "Tilslut én Portenta H7, opdatér portlisten, og vælg dens port igen.");
                    return;
                }
                // The core selects the DFU device by USB vendor/product ID after the serial reset.
                await Log($"Uploader til Portenta H7 på {ports[0]}…");
                var result = await Invoke(["upload", "--fqbn", BuildBoard, "--port", ports[0], "--input-dir", BuildFolder, DraftFolder], Log, timeout.Token);
                await Finish(result == 0, result == 0 ? "Upload færdig. Tilslut Arduino igen for at læse Serial." : "Upload mislykkedes. Se loggen ovenfor.");
            }
            else
            {
                compiledVersion = null;
                if (AllowsHostedCompile) hostedBuild = Directory.CreateTempSubdirectory("fishnship-build-");
                var draft = hostedBuild is null ? DraftFolder : Path.Combine(hostedBuild.FullName, "Demo");
                var build = hostedBuild is null ? BuildFolder : Path.Combine(hostedBuild.FullName, "build");
                Directory.CreateDirectory(draft);
                await File.WriteAllTextAsync(Path.Combine(draft, "Demo.ino"), edit.Code!, timeout.Token);
                await Log("Kompilerer til Arduino Portenta H7 (M7)…");
                var result = await Invoke(["compile", "--fqbn", BuildBoard, "--jobs", hostedBuild is null ? "8" : "2", "--build-path", build, "--verbose", draft], Log, timeout.Token, temporaryDirectory: hostedBuild?.FullName);
                var success = result == 0 && File.Exists(Path.Combine(build, "Demo.ino.bin"));
                if (success && hostedBuild is null) compiledVersion = version;
                await Finish(success, success ? "Kompilering lykkedes." : "Kompilering mislykkedes. Se loggen ovenfor.");
            }
        }
        catch (Win32Exception) { await Finish(false, "Arduino CLI blev ikke fundet. Installér Arduino IDE eller sæt Arduino__CliPath."); }
        catch (OperationCanceledException) { await Finish(false, "Arduino CLI blev afbrudt eller overskred tidsgrænsen."); }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or JsonException)
        {
            await Finish(false, "Arduino CLI kunne ikke fuldføre handlingen. " + ex.Message);
        }
        finally
        {
            try { hostedBuild?.Delete(recursive: true); }
            finally { operation.Release(); }
        }
    }

    private async Task<string[]> DetectPorts(CancellationToken token)
    {
        var output = new StringBuilder();
        var result = await Invoke(["board", "list", "--json"], line => { output.AppendLine(line); return Task.CompletedTask; }, token, readErrors: false);
        if (result != 0) throw new InvalidOperationException("Arduino CLI kunne ikke læse USB-portene.");

        using var json = JsonDocument.Parse(output.ToString());
        if (!json.RootElement.TryGetProperty("detected_ports", out var ports) || ports.ValueKind != JsonValueKind.Array) return [];
        return ports.EnumerateArray()
            .Where(entry => entry.TryGetProperty("matching_boards", out var boards) && boards.EnumerateArray().Any(board => board.GetProperty("fqbn").GetString() == Board))
            .Select(entry => entry.GetProperty("port"))
            .Where(port => port.GetProperty("protocol").GetString() == "serial")
            .Select(port => port.GetProperty("address").GetString()!)
            .Distinct(StringComparer.Ordinal).ToArray();
    }

    private async Task<int> Invoke(string[] args, Func<string, Task> log, CancellationToken token, bool readErrors = true, string? temporaryDirectory = null)
    {
        using var process = new Process { StartInfo = new(cli) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        if (temporaryDirectory is not null)
        {
            process.StartInfo.Environment["TMPDIR"] = temporaryDirectory;
            process.StartInfo.Environment["ARDUINO_BUILD_CACHE_PATH"] = Path.Combine(temporaryDirectory, "cache");
        }
        if (cliConfig is not null)
        {
            process.StartInfo.ArgumentList.Add("--config-file");
            process.StartInfo.ArgumentList.Add(cliConfig);
        }
        foreach (var arg in args) process.StartInfo.ArgumentList.Add(arg);

        token.ThrowIfCancellationRequested();
        process.Start();
        using var cancellation = token.Register(() =>
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (Exception ex) when (ex is InvalidOperationException or Win32Exception) { }
        });
        await Task.WhenAll(ReadLines(process.StandardOutput, log), ReadLines(process.StandardError, readErrors ? log : _ => Task.CompletedTask), process.WaitForExitAsync());
        token.ThrowIfCancellationRequested();
        return process.ExitCode;
    }

    private static async Task ReadLines(StreamReader reader, Func<string, Task> log)
    {
        while (await reader.ReadLineAsync() is { } line) await log(line);
    }

    private static bool ValidCode(string? code) => !string.IsNullOrWhiteSpace(code) && code.Length <= MaxSketchLength;
    private static string VersionOf(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));

    private static string ResolveSketch(IWebHostEnvironment environment, IConfiguration configuration)
    {
        if (configuration["Arduino:SketchPath"] is { } configured) return Path.GetFullPath(configured);
        var project = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "..", "Demo", "Demo.ino"));
        return File.Exists(project) ? project : Path.Combine(environment.ContentRootPath, "Demo", "Demo.ino");
    }

    private static string ResolveCli(IConfiguration configuration)
    {
        if (configuration["Arduino:CliPath"] is { } configured) return configured;
        var ide = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Arduino IDE", "resources", "app", "lib", "backend", "resources", "arduino-cli.exe");
        return OperatingSystem.IsWindows() && File.Exists(ide) ? ide : "arduino-cli";
    }

    private static string? ResolveConfig(IConfiguration configuration)
    {
        if (configuration["Arduino:CliConfig"] is { } configured) return configured;
        var ide = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".arduinoIDE", "arduino-cli.yaml");
        return File.Exists(ide) ? ide : null;
    }

    public void Dispose()
    {
        if (Directory.Exists(scratch)) Directory.Delete(scratch, recursive: true);
        operation.Dispose();
    }
}
