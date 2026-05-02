# Prompt 05 — Frontend (Next.js + UX + Slugs) SIGM

Actúa como un Desarrollador Frontend Senior experto en Next.js (App Router), UX profesional y arquitectura de interfaces tipo SaaS.

---

## 🎯 Objetivo
Construir el frontend completo del SIGM con una interfaz moderna, funcional y conectada correctamente al backend.

---

## ⚙️ Stack obligatorio

- Next.js (App Router)
- React
- Fetch API o cliente HTTP (explicar elección)
- Estilos: puedes usar TailwindCSS o CSS modular

---

## 🧠 Contexto del sistema

El sistema tiene dos áreas principales:

### 1. Portal Público
- Información institucional
- Directorio dinámico de sucursales

### 2. Dashboard Interno
- Gestión de actas
- Interfaz para operadores y admin

---

## 🧱 Estructura del proyecto (OBLIGATORIO)

Define una estructura clara, por ejemplo:

- app/
  - layout.tsx
  - page.tsx
  - sucursal/[slug]/page.tsx
  - dashboard/
- components/
- services/
- hooks/
- types/

Explica brevemente cada carpeta.

---

## 🌐 Portal público

Debe incluir:

- Página principal con secciones:
  - Quiénes somos
  - Servicios
  - Base legal
  - Directorio de sucursales

---

### 🔗 Rutas dinámicas (CRÍTICO)

Implementar:

/sucursal/[slug]

Requisitos:

- slug generado automáticamente desde backend
- fetch de datos desde API
- render dinámico con template

---

### 📌 Menú dinámico

- listar sucursales desde base de datos
- actualizar automáticamente (sin hardcode)

---

## 🧑‍💻 Dashboard interno

### Layout obligatorio:

- Sidebar (navegación)
- Área de contenido principal

---

### Funcionalidades mínimas:

#### 1. Crear acta

Formulario con:

- cédula (input clave)
- nombre (auto-carga si existe)
- teléfono
- email
- subida de PDF

---

### ⚠️ Validaciones en frontend

- validar cédula en tiempo real (formato)
- mostrar si cliente ya existe
- evitar envíos inválidos

---

## 🔌 Conexión con backend

- consumir endpoints:
  - POST /actas
  - GET /actas/{codigo}

- manejar:
  - loading states
  - errores
  - respuestas exitosas

---

## 📤 Formato de respuesta (OBLIGATORIO)

Responde EXACTAMENTE en este orden:

### 1. Estructura del proyecto
- árbol de carpetas
- explicación breve

### 2. Layout general
- implementación de layout (sidebar + content)

### 3. Página pública
- implementación básica
- componentes

### 4. Rutas dinámicas
- implementación de /sucursal/[slug]
- fetch de datos

### 5. Dashboard
- formulario de creación de acta

### 6. Validaciones frontend
- ejemplos claros

### 7. Conexión con backend
- ejemplos de fetch
- manejo de estados

---

## 🚨 Restricciones críticas

- NO hardcodear datos de sucursales
- NO omitir validaciones de formulario
- NO mezclar lógica en componentes (usar services/hooks)
- Código debe ser limpio y reutilizable
- NO simplificar UI a nivel básico

---

## 🧠 Nota final

Si el código es muy extenso:
- dividir por componentes
- mantener estructura clara
- no omitir partes críticas
