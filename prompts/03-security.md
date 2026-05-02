# Prompt 03 — Seguridad, RBAC y Middleware (SIGM)

Actúa como un Ingeniero de Seguridad Backend Senior experto en control de acceso (RBAC), FastAPI y protección de datos sensibles.

---

## 🎯 Objetivo
Implementar un sistema de control de acceso robusto para el SIGM que garantice aislamiento total de datos entre sucursales y control estricto por roles.

---

## 🔐 Contexto del sistema

Roles existentes:

- admin (Administrador Nacional)
- operador (Usuario de sucursal)

---

## 📌 Reglas de acceso obligatorias

### 👤 OPERADOR

- SOLO puede acceder a datos de SU sucursal
- Permisos:
  - CREATE
  - READ

- Restricciones:
  - NO puede UPDATE
  - NO puede DELETE
  - NO puede ver datos de otras sucursales

---

### 👑 ADMIN

- Acceso total a todas las sucursales
- Puede:
  - READ
  - CREATE
  - UPDATE
- Puede editar actas (pero NO modificar `fecha_creacion`)
- Puede reemplazar archivos PDF

---

## ⚙️ Requisitos técnicos

- Backend: FastAPI
- Autenticación: Supabase Auth (JWT)
- Uso de middleware o dependencias de FastAPI para control de acceso
- Sistema completamente async

---

## 🧠 Requisitos de implementación

### 1. Autenticación

- Validar JWT proveniente de Supabase
- Extraer:
  - user_id
  - rol
  - sucursal_id

---

### 2. Middleware / Dependencias

Implementar lógica que:

- valide que el usuario está autenticado
- identifique su rol
- restrinja acceso según rol

---

### 3. Aislamiento por sucursal (CRÍTICO)

- TODAS las consultas deben filtrarse automáticamente por `sucursal_id` si el usuario es operador
- El operador NUNCA debe poder modificar el filtro manualmente

---

### 4. Protección de endpoints

Ejemplos:

- Crear acta → permitido para operador
- Editar acta → SOLO admin
- Ver actas:
  - operador → solo su sucursal
  - admin → todas

---

### 5. Protección de integridad

- Garantizar que `fecha_creacion`:
  - nunca se modifique desde backend
  - aunque un admin haga UPDATE

---

### 6. Configuración CORS

Permitir SOLO:

- dominio del frontend (ej: Vercel)
- localhost (desarrollo)

Bloquear cualquier otro origen

---

## 📤 Formato de respuesta (OBLIGATORIO)

Responde EXACTAMENTE en este orden:

### 1. Estrategia de seguridad general
- cómo funciona el flujo de autenticación + autorización

### 2. Validación de JWT (Supabase)
- ejemplo de implementación en FastAPI

### 3. Dependencias o middleware
- funciones reutilizables para:
  - usuario actual
  - verificación de rol

### 4. Aislamiento por sucursal
- cómo se implementa en queries o services
- ejemplo concreto

### 5. Protección de endpoints
- ejemplos claros:
  - endpoint permitido
  - endpoint bloqueado

### 6. Protección de `fecha_creacion`
- estrategia backend para evitar modificación

### 7. Configuración CORS
- ejemplo en FastAPI

---

## 🚨 Restricciones críticas

- NO confiar en datos enviados por el frontend
- NO permitir que el cliente envíe `sucursal_id` libremente
- SIEMPRE usar datos del token
- NO omitir validación de rol
- Código debe ser real, no pseudocódigo

---

## 🧠 Nota final

Si la respuesta es extensa:
- dividir en secciones
- mantener estructura clara
- no omitir seguridad crítica
