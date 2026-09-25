# Centro de Mediación NUMA — Frontend

Sistema de gestión institucional para el Centro de Mediación NUMA, construido con **Next.js 14 (App Router)**, **Tailwind CSS** y **Axios**.

---

## 🚀 Inicio Rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.local.example .env.local
# Editar .env.local con la URL de tu backend

# 3. Iniciar en desarrollo
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

---

## ⚙️ Variables de Entorno

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Para producción en Vercel, agregar esta variable en el panel de configuración.

---

## 📁 Estructura del Proyecto

```
src/
├── app/
│   ├── page.tsx              # Página pública institucional
│   ├── login/page.tsx        # Login
│   ├── dashboard/page.tsx    # Panel principal
│   ├── actas/page.tsx        # Gestión de actas
│   ├── sucursales/page.tsx   # Gestión de sucursales
│   ├── ciudades/page.tsx     # Gestión de ciudades
│   ├── clientes/page.tsx     # Gestión de clientes
│   └── usuarios/page.tsx     # Perfil de usuario
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx       # Menú lateral
│   │   └── DashboardLayout.tsx
│   ├── public/
│   │   ├── PublicNavbar.tsx
│   │   └── PublicFooter.tsx
│   └── ui/
│       └── index.tsx         # Componentes reutilizables
├── hooks/
│   └── useAuth.ts            # Hook de autenticación
├── lib/
│   ├── api.ts                # Instancia Axios con interceptors
│   ├── auth.ts               # Utilidades JWT
│   └── services.ts           # Llamadas a la API
└── types/
    └── index.ts              # TypeScript types
```

---

## 🔐 Autenticación

- Login con `POST /login` (form-data: `username`, `password`)
- Token JWT almacenado en `localStorage`
- Interceptor Axios agrega `Authorization: Bearer <token>` automáticamente
- En error 401 → logout automático y redirección a `/login`

---

## 📦 Módulos

| Módulo | Ruta | Descripción |
|--------|------|-------------|
| Página Pública | `/` | Información institucional NUMA |
| Login | `/login` | Autenticación |
| Dashboard | `/dashboard` | Estadísticas generales |
| Actas | `/actas` | Gestión y flujo de actas |
| Sucursales | `/sucursales` | CRUD de sucursales |
| Ciudades | `/ciudades` | CRUD de ciudades |
| Clientes | `/clientes` | CRUD de clientes |
| Usuarios | `/usuarios` | Perfil y configuración |

---

## 🔄 Flujo de Estados de Actas

```
borrador → enviado → aprobado
                   → rechazado
```

- Usuarios normales: pueden crear y enviar actas
- Administradores: pueden aprobar o rechazar

---

## 🚀 Deploy en Vercel

1. Conectar repositorio en [vercel.com](https://vercel.com)
2. Agregar variable de entorno: `NEXT_PUBLIC_API_URL`
3. Deploy automático en cada push a `main`

```bash
# Build de producción local
npm run build
npm run start
```

---

## 🛠 Tecnologías

- **Next.js 14** — App Router
- **React 18** — UI
- **TypeScript** — Tipado estático
- **Tailwind CSS** — Estilos
- **Axios** — HTTP client con interceptors
- **Lucide React** — Iconos
