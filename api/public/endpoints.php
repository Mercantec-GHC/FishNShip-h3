<?php
use App\Routers\ApiRouter;
use App\Services\DatabaseService;

$api = new ApiRouter();

$db = DatabaseService::getInstance();

$api->addEndpoint('GET', '/status', function () {
    echo json_encode([
        "api" => "online",
        "database" => DatabaseService::isOnline() ? "online" : "offline",
    ]);
});

$api->addEndpoint('GET', '/items', function() use ($db) {
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);

    if ($id === null || $id === false) {
        echo json_encode($db->run('SELECT name FROM items')->fetchAll());
        return;
    }

    $item = $db->run('SELECT name FROM items WHERE id = ?', [$id])->fetch();
    if (!$item) {
        http_response_code(404);
        echo json_encode(['error' => 'Item not found']);
        return;
    }
    echo json_encode($item);
});