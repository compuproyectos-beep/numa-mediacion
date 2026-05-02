# Prompt 06 — Infraestructura y DevOps (SIGM)

Actúa como un DevOps Engineer Senior experto en despliegue de aplicaciones modernas, configuración de entornos y optimización de recursos en la nube.

---

## 🎯 Objetivo
Configurar la infraestructura completa del SIGM para un entorno de producción ligero, seguro y escalable.

---

## ⚙️ Stack del sistema

- Frontend: Next.js desplegado en Vercel
- Backend: FastAPI desplegado en Railway
- Base de datos: PostgreSQL (Supabase)
- Email: sistema modular (Resend para pruebas / SMTP para producción)

---

## 🧠 Contexto

El sistema debe funcionar con recursos limitados:

- Railway: ~256MB RAM
- Bajo costo mensual
- Soporte para múltiples usuarios concurrentes

---

## 🔧 Requisitos de implementación

---

### 1. Variables de entorno (.env)

Definir claramente todas las variables necesarias:

#### Backend:

- DATABASE_URL
- SUPABASE_URL
- SUPABASE_KEY
- JWT_SECRET (si aplica)
- SMTP_SERVER
- SMTP_PORT
- SMTP_USER
- SMTP_PASSWORD
- EMAIL_PROVIDER (resend | smtp)

#### Frontend:

- NEXT_PUBLIC_API_URL
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

Explicar brevemente el uso de cada variable.

---

### 2. Endpoint /health (CRÍTICO)

Objetivo:

- evitar que Railway “duerma” el servicio

Requisitos:

- endpoint GET /health
- respuesta simple (status OK)
- preparado para monitoreo o keep-alive externo

---

### 3. Script de limpieza (SQL)

Proveer script para:

- borrar datos de prueba
- reiniciar IDs (secuencias)
- mantener estructura intacta

Usar:
- TRUNCATE con RESTART IDENTITY
- CASCADE si es necesario

---

### 4. Flujo de creación de usuario

Implementar lógica para:

- crear usuario en Supabase Auth
- registrar en tabla `usuarios`
- enviar email automático con credenciales

---

### 5. Sistema de email modular

Requisitos:

- permitir cambiar entre:
  - Resend (testing)
  - SMTP (producción, ej: Zoho)

- configuración vía variables de entorno
- lógica desacoplada (no hardcode)

---

### 6. Configuración de despliegue

Describir:

#### Frontend (Vercel):

- conexión con repositorio
- variables de entorno
- build automático

#### Backend (Railway):

- despliegue desde repo
- configuración de variables
- uso eficiente de recursos (async, bajo consumo)

---

## 📤 Formato de respuesta (OBLIGATORIO)

Responde EXACTAMENTE en este orden:

### 1. Variables de entorno
- listado completo
- explicación breve

### 2. Endpoint /health
- implementación en FastAPI

### 3. Script SQL de limpieza
- código completo

### 4. Flujo de creación de usuario
- explicación + ejemplo

### 5. Sistema de email modular
- implementación clara

### 6. Despliegue
- pasos para Vercel
- pasos para Railway

---

## 🚨 Restricciones críticas

- NO hardcodear credenciales
- NO omitir variables de entorno
- NO mezclar configuraciones
- código debe ser listo para producción

---

## 🧠 Nota final

Si alguna sección es extensa:
- dividir claramente
- mantener orden
- no omitir configuración crítica
