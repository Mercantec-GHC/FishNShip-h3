<?php
declare(strict_types=1);

namespace App\Services;

use PDO;
use PDOException;

final class DatabaseService
{
    protected static ?DatabaseService $instance = null;
    protected PDO $db;

    private function __construct()
    {
        try {
            $this->db = new PDO("mysql:host={$_ENV['MYSQL_HOST']};dbname={$_ENV['MYSQL_DATABASE']};charset=utf8mb4", $_ENV['MYSQL_USERNAME'], $_ENV['MYSQL_PASSWORD']);
            $this->db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_OBJ);
        } catch (PDOException $e) {
            echo "Database connection failed: " . $e->getMessage();
            return;
        }
    }

    public static function isOnline(): bool
    {
        try {
            // Try connecting with a 2-second timeout so it doesn't hang
            $pdo = new PDO(
                "mysql:host={$_ENV['MYSQL_HOST']};dbname={$_ENV['MYSQL_DATABASE']};charset=utf8mb4", 
                $_ENV['MYSQL_USERNAME'], 
                $_ENV['MYSQL_PASSWORD'], 
                [PDO::ATTR_TIMEOUT => 2]
            );
            return true;
        } catch (PDOException $e) {
            return false;
        }
    }

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function query(string $query): \PDOStatement|false
    {
        return $this->db->query($query);
    }

    public function run(string $sql, array $args = []): \PDOStatement
    {
        if (!$args) {
            return $this->query($sql);
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($args);

        return $stmt;
    }
}