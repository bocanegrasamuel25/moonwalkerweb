-- Base de datos de Moon Walker

CREATE DATABASE IF NOT EXISTS moonwalker;
USE moonwalker;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  correo VARCHAR(150) NOT NULL UNIQUE,
  contrasena_hash VARCHAR(255) NOT NULL,
  fecha_nacimiento DATE NOT NULL,
  rol ENUM('paciente','fisioterapeuta') NOT NULL DEFAULT 'paciente',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
