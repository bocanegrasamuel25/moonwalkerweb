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

-- Enlaces para cambiar la contraseña (se guarda el hash del código, no el código)
CREATE TABLE IF NOT EXISTS recuperaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  codigo_hash CHAR(64) NOT NULL UNIQUE,
  expira DATETIME NOT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);
