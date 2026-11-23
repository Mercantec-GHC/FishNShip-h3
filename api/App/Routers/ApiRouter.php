<?php
declare(strict_types=1);

namespace App\Routers;

final class ApiRouter
{
    private array $routes = [];

    public function addEndpoint(string $method, string $path, callable $handler): void
    {
        // "/items/{id}" becomes "#^/items/(?<id>[^/]+)$#"
        $pattern = '#^' . preg_replace('#\{(\w+)\}#', '(?<$1>[^/]+)', $path) . '$#';
        $this->routes[strtoupper($method)][$pattern] = $handler;
    }

    public function handleRequest(): void
    {
        $method = $_SERVER['REQUEST_METHOD'];
        $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

        // Strip the folder the API is installed in, e.g. "/FishNShip-h3/api"
        $basePath = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\');
        if ($basePath !== '' && str_starts_with($path, $basePath)) {
            $path = substr($path, strlen($basePath));
        }
        $path = '/' . trim($path, '/');   // Also handles trailing slash

        // Grab params from url
        foreach ($this->routes[$method] ?? [] as $pattern => $handler) {
            if (preg_match($pattern, $path, $matches)) {
                $pathParams = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
                $handler($pathParams + $_GET);   // path params win over ?query params
                return;
            }
        }

        if (isset($this->routes[$method][$path])) {
            call_user_func($this->routes[$method][$path]);
        } else {
            http_response_code(404);
            echo json_encode(["error" => "Endpoint not found", "path" => $path]);
        }
    }
}