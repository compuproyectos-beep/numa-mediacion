# Prompt 02 — Backend FastAPI (SIGM)

Actúa como un Ingeniero Backend Senior experto en FastAPI, PostgreSQL, asincronía y validación de datos en sistemas críticos.

---

## 🎯 Objetivo
Implementar el backend del "Sistema Integral de Gestión de Mediación (SIGM)" garantizando integridad de datos, validaciones estrictas y arquitectura profesional.

---

## ⚙️ Stack obligatorio

- FastAPI (async)
- PostgreSQL (Supabase)
- Conexión usando SQLAlchemy o queries directas (elige la mejor opción y justifica)
- Despliegue pensado para Railway (256MB RAM)

---

## 📁 Estructura del proyecto (OBLIGATORIO)

Define una estructura profesional de carpetas, por ejemplo:

- app/
  - main.py
  - api/
  - models/
  - schemas/
  - services/
  - core/
  - db/

Explica brevemente la responsabilidad de cada carpeta.

---

## 📌 Reglas de negocio obligatorias

1. Cliente:
   - identificado por `cedula`
   - exactamente 10 dígitos
   - validar con algoritmo ecuatoriano (módulo 10)

2. Creación de acta:
   - antes de crear → buscar cliente por cédula
   - si existe → reutilizar
   - si no → crear cliente

3. Código de acta:
   - formato: PREFIJO-SECUENCIAL
   - secuencial independiente por sucursal
   - evitar colisiones

4. Sistema debe ser completamente async

---

## 🧠 Validaciones obligatorias (Pydantic)

Implementar modelos con:

- cédula:
  - string numérico
  - longitud 10
  - validación ecuatoriana

- teléfono:
  - máximo 10 dígitos

- email:
  - usar EmailStr

---

## 🔌 Endpoints requeridos

Implementar mínimo:

### 1. Crear cliente
- POST /clientes
- validar duplicados por cédula

### 2. Crear acta
- POST /actas
- lógica:
  - validar cliente
  - generar código único
  - guardar acta

### 3. Obtener acta
- GET /actas/{codigo_acta}
- búsqueda por campo único

---

## ⚠️ Manejo de errores

- Respuestas HTTP claras (400, 404, 409, 500)
- Mensajes descriptivos
- Manejo de excepciones centralizado

---

## 📤 Formato de respuesta (OBLIGATORIO)

Responde EXACTAMENTE en este orden:

### 1. Estructura del proyecto
- árbol de carpetas
- explicación breve

### 2. Configuración base
- conexión a base de datos
- setup inicial FastAPI

### 3. Modelos Pydantic
- con validaciones completas

### 4. Lógica de negocio (services)
- funciones separadas:
  - validar cédula
  - buscar/crear cliente
  - generar código de acta

### 5. Endpoints
- implementación completa
- async
- listos para producción

### 6. Manejo de errores
- ejemplo práctico

---

## 🚨 Restricciones críticas

- NO mezclar lógica en endpoints (usar services)
- NO omitir validaciones
- NO usar código síncrono
- NO simplificar generación de código de acta
- Código debe ser ejecutable

---

## 🧠 Nota final

Si la respuesta es muy larga:
- dividir en partes claramente
- continuar sin perder estructura
