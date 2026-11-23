using System.Net;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 1024 * 1024);
builder.Services.AddSingleton<FirmwareWorkspace>();
var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

var firmware = app.MapGroup("/api/firmware");
firmware.MapGet("/sketch", (FirmwareWorkspace workspace) => Results.Ok(workspace.ReadSketch()));
firmware.MapPost("/sketch", (HttpContext context, SketchEdit edit, FirmwareWorkspace workspace) =>
    IsLocalEditor(context) ? workspace.SaveSketch(edit) : Results.StatusCode(403));
firmware.MapPost("/ports", async (HttpContext context, FirmwareWorkspace workspace) =>
    IsLocalEditor(context) ? await workspace.ListPorts(context.RequestAborted) : Results.StatusCode(403));
firmware.MapPost("/compile", async (HttpContext context, SketchEdit edit, FirmwareWorkspace workspace) =>
{
    if (!IsLocalEditor(context)) { context.Response.StatusCode = 403; return; }
    await workspace.Run(context, edit, upload: false);
});
firmware.MapPost("/upload", async (HttpContext context, SketchEdit edit, FirmwareWorkspace workspace) =>
{
    if (!IsLocalEditor(context)) { context.Response.StatusCode = 403; return; }
    await workspace.Run(context, edit, upload: true);
});

app.Run(app.Configuration["urls"] ?? "http://localhost:5080");

static bool IsLocalEditor(HttpContext context) =>
    context.Connection.RemoteIpAddress is { } address && IPAddress.IsLoopback(address) &&
    (string.Equals(context.Request.Host.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
     IPAddress.TryParse(context.Request.Host.Host.Trim('[', ']'), out var hostAddress) && IPAddress.IsLoopback(hostAddress)) &&
    context.Request.Headers["X-Lager-Editor"] == "1";
