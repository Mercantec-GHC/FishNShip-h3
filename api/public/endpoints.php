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

$api->addEndpoint('GET', '/fish', function() use ($db) {
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    $hasId = isset($_GET['id']);

    // Make sure the givin id is valid
    if ($hasId && $id === false) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid ID format']);
        return;
    }

    // Get all fish
    if (!$hasId) {
        $items = $db->run('SELECT id, name, price FROM fish')->fetchAll();
        
        if (empty($items)) {
            http_response_code(404);
            echo json_encode(['error' => 'No items found']);
            return;
        }
        
        echo json_encode($items);
        return;
    }

    // Get exact fish
    $item = $db->run('SELECT id, name, price FROM fish WHERE id = ?', [$id])->fetch();

    if (!$item) {
        http_response_code(404);
        echo json_encode(['error' => 'Item not found']);
        return;
    }
    $item = ['fish' => $item];

    echo json_encode($item);
});

// // User
// $api->addEndpoint('POST', '/login', function() use ($db) {


//     echo json_encode();
// });

// $api->addEndpoint('POST', '/register', function() use ($db) {

//     echo json_encode();
// });