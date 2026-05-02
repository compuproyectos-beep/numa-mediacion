# Prompt 04 — Lógicas Críticas de Negocio (SIGM)

Actúa como un Ingeniero de Software Senior especializado en lógica de negocio, integridad de datos y sistemas legales.

---

## 🎯 Objetivo
Implementar funciones críticas del SIGM de forma modular, reutilizable y segura, garantizando consistencia de datos y evitando errores comunes en producción.

---

## ⚙️ Contexto

Sistema de mediación con:

- Clientes únicos por cédula
- Actas con código único por sucursal
- Validaciones estrictas (legalmente relevantes)

---

## 🧠 Funciones obligatorias

Debes implementar las siguientes funciones de forma separada, clara y reutilizable:

---

### 1. Validación de cédula ecuatoriana

Requisitos:

- exactamente 10 dígitos numéricos
- implementar algoritmo oficial (módulo 10)
- rechazar:
  - longitudes incorrectas
  - caracteres no numéricos
  - números inválidos según algoritmo

Debe devolver:
- True / False o lanzar excepción clara

---

### 2. Función anti-duplicado de cliente

Objetivo:
Evitar múltiples registros para una misma persona.

Lógica obligatoria:

- buscar cliente por `cedula`
- si existe → retornar cliente existente
- si NO existe → crear nuevo cliente

Debe ser:
- segura para concurrencia
- evitar duplicados incluso con múltiples requests simultáneos

---

### 3. Generación de código de acta

Formato:

PREFIJO-SECUENCIAL

Ejemplo:
UIO-001

Requisitos:

- secuencial independiente por sucursal
- obtener último número usado
- incrementar correctamente
- evitar colisiones en concurrencia

Debe contemplar:

- uso de transacciones o bloqueo (locking)
- alternativa segura (ej: tabla de secuencias por sucursal)

---

### 4. Compresión segura de PDF

Objetivo:
Reducir tamaño sin romper validez legal.

Requisitos:

- usar pypdf
- aplicar:
  page.compress_content_streams()

PROHIBIDO:

- eliminar fuentes
- alterar estructura interna
- romper firmas digitales

---

## 📤 Formato de respuesta (OBLIGATORIO)

Responde EXACTAMENTE en este orden:

### 1. Explicación general
- cómo se organizan las funciones
- por qué son críticas

### 2. Validación de cédula
- implementación completa
- explicación breve

### 3. Función anti-duplicado
- implementación
- manejo de concurrencia

### 4. Generación de código de acta
- implementación
- estrategia anti-colisión

### 5. Compresión de PDF
- implementación segura

---

## ⚠️ Restricciones críticas

- NO mezclar funciones (cada una separada)
- NO simplificar lógica de concurrencia
- NO usar pseudocódigo
- código debe ser listo para producción

---

## 🧠 Nota final

Si alguna función es extensa:
- dividir en bloques claros
- mantener modularidad
- no omitir validaciones críticas
