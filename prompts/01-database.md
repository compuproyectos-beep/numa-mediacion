# Prompt 01 — Arquitectura y Base de Datos (SIGM)

Actúa como un Arquitecto de Software Senior experto en PostgreSQL, modelado de datos relacional e integridad legal de sistemas gubernamentales.

## 🎯 Objetivo
Diseñar la arquitectura de base de datos completa para el "Sistema Integral de Gestión de Mediación (SIGM)", listo para producción en PostgreSQL (Supabase).

---

## 📌 Contexto del sistema
Sistema para un centro de mediación con múltiples sedes a nivel nacional (Ecuador).

### Reglas de negocio críticas:
- Jerarquía obligatoria: ciudades → sucursales
- Usuarios SIEMPRE pertenecen a una sucursal
- Clientes son únicos por cédula (10 dígitos, validación ecuatoriana)
- Actas:
  - código único por sucursal (prefijo + secuencial)
  - fecha_creacion: inmutable
  - fecha_modificacion: automática mediante trigger
- NO se permite DELETE físico en usuarios (usar campo `activo`)
- Se requiere trazabilidad histórica completa
- Relaciones estrictas con claves foráneas (FK)

---

## ⚙️ Requisitos técnicos obligatorios

- Base de datos: PostgreSQL (compatible con Supabase)
- Uso de:
  - PRIMARY KEY
  - FOREIGN KEY
  - UNIQUE
  - INDEXES donde sea necesario
- Integridad referencial estricta
- Diseño optimizado para consultas frecuentes

---

## 🧱 Entidades mínimas requeridas

Debes incluir al menos estas tablas:

- ciudades
- sucursales
- clientes
- usuarios
- actas

Puedes agregar tablas adicionales si son necesarias para integridad o escalabilidad.

---

## 🚨 Restricciones importantes

1. `clientes.cedula` debe ser UNIQUE
2. `actas.codigo_acta` debe ser UNIQUE
3. `fecha_creacion`:
   - DEFAULT now()
   - NO debe poder modificarse después del insert
4. `fecha_modificacion`:
   - se actualiza automáticamente con TRIGGER en cada UPDATE
5. Usuarios:
   - NO DELETE físico
   - usar campo `activo BOOLEAN`
6. Secuencial de actas:
   - NO global
   - debe ser independiente por sucursal

---

## 📤 Formato de respuesta (OBLIGATORIO)

Responde EXACTAMENTE en este orden:

### 1. Explicación del modelo (breve pero clara)
- Describe relaciones entre tablas
- Justifica decisiones clave

### 2. Diagrama lógico (texto)
- Representación tipo:
  ciudad → sucursal → usuario → acta → cliente

### 3. Script SQL completo
Debe incluir:
- CREATE TABLE
- PRIMARY KEYS
- FOREIGN KEYS
- UNIQUE constraints
- INDEXES
- DEFAULT values

### 4. Trigger PostgreSQL
- Para actualizar `fecha_modificacion`
- Explicar cómo funciona

### 5. Estrategia de secuencial por sucursal
- Explicar cómo evitar colisiones
- Proponer implementación (ej: tabla auxiliar o query segura)

### 6. Restricción de inmutabilidad
- Cómo garantizar que `fecha_creacion` no se pueda modificar

---

## ⚠️ Reglas de calidad

- NO simplificar lógica
- NO omitir constraints
- NO usar pseudo-código en SQL
- Todo debe ser ejecutable en PostgreSQL real

---

## 🧠 Nota final

Si alguna parte es demasiado extensa:
- divídela claramente por secciones
- NO omitas contenido crítico
