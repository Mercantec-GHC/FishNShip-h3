<?php
require_once __DIR__ . '/vendor/autoload.php';

header("Content-Type: application/json");

use App\Routers\ApiRouter;

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad();

$api = new ApiRouter();

require_once __DIR__ . '/public/endpoints.php';

$api->handleRequest();