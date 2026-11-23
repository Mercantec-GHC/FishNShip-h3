using System.Net;
using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
var hostedOrigin = builder.Configuration["Arduino:HostedOrigin"] ?? "https://fishnship.mercantec.tech";
var bridgeKey = RandomNumberGenerator.GetHexString(32);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 1024 * 1024);
builder.Services.AddSingleton<FirmwareWorkspace>();
builder.Services.AddCors(options => options.AddPolicy("HostedUpload", policy => policy
    .WithOrigins(hostedOrigin).WithMethods("POST").WithHeaders("Content-Type", "X-FishNShip-Key")));
var app = builder.Build();

app.UseDefaultFiles(new DefaultFilesOptions { RedirectToAppendTrailingSlash = false });
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = file => file.Context.Response.Headers.CacheControl = "no-cache",
});
app.UseCors();

var firmware = app.MapGroup("/api/firmware");
firmware.MapGet("/sketch", (FirmwareWorkspace workspace) => Results.Ok(workspace.ReadSketch()));
firmware.MapPost("/sketch", (HttpContext context, SketchEdit edit, FirmwareWorkspace workspace) =>
    IsLocalEditor(context) ? workspace.SaveSketch(edit) : Results.StatusCode(403));
firmware.MapPost("/ports", async (HttpContext context, FirmwareWorkspace workspace) =>
    IsLocalEditor(context) ? await workspace.ListPorts(context.RequestAborted) : Results.StatusCode(403));
firmware.MapPost("/compile", async (HttpContext context, SketchEdit edit, FirmwareWorkspace workspace) =>
{
    if (!IsLocalEditor(context) &&
        !(workspace.AllowsHostedCompile && context.Request.Headers["X-Lager-Editor"] == "1"))
    {
        context.Response.StatusCode = 403;
        return;
    }
    await workspace.Run(context, edit, upload: false);
});
firmware.MapPost("/upload", async (HttpContext context, SketchEdit edit, FirmwareWorkspace workspace) =>
{
    if (!IsLocalEditor(context)) { context.Response.StatusCode = 403; return; }
    await workspace.Run(context, edit, upload: true);
});

firmware.MapPost("/bridge-key", (HttpContext context, FirmwareWorkspace workspace) =>
{
    var origin = context.Request.Headers.Origin.ToString();
    if (!workspace.LocalToolsEnabled || !IsLocalEditor(context) ||
        (origin.Length > 0 && origin != $"{context.Request.Scheme}://{context.Request.Host.Value}"))
        return Results.StatusCode(403);

    context.Response.Headers.CacheControl = "no-store";
    return Results.Ok(new { key = bridgeKey });
});

var bridge = app.MapGroup("/api/usb").RequireCors("HostedUpload");
bridge.MapPost("/ports", async (HttpContext context, FirmwareWorkspace workspace) =>
    IsPaired(context, workspace) ? await workspace.ListPorts(context.RequestAborted) : Results.StatusCode(403));
bridge.MapPost("/compile", async (HttpContext context, SketchEdit edit, FirmwareWorkspace workspace) =>
{
    if (!IsPaired(context, workspace)) { context.Response.StatusCode = 403; return; }
    await workspace.Run(context, edit, upload: false);
});
bridge.MapPost("/upload", async (HttpContext context, SketchEdit edit, FirmwareWorkspace workspace) =>
{
    if (!IsPaired(context, workspace)) { context.Response.StatusCode = 403; return; }
    await workspace.Run(context, edit, upload: true);
});

app.Run(app.Configuration["urls"] ?? "http://localhost:5080");

bool IsPaired(HttpContext context, FirmwareWorkspace workspace)
{
    var key = context.Request.Headers["X-FishNShip-Key"].ToString();
    return workspace.LocalToolsEnabled && IsLoopback(context) &&
        context.Request.Headers.Origin == hostedOrigin &&
        key.Length == bridgeKey.Length &&
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(bridgeKey));
}

static bool IsLocalEditor(HttpContext context) =>
    IsLoopback(context) && context.Request.Headers["X-Lager-Editor"] == "1";

static bool IsLoopback(HttpContext context) =>
    context.Connection.RemoteIpAddress is { } address && IPAddress.IsLoopback(address) &&
    (string.Equals(context.Request.Host.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
     IPAddress.TryParse(context.Request.Host.Host.Trim('[', ']'), out var hostAddress) && IPAddress.IsLoopback(hostAddress));
