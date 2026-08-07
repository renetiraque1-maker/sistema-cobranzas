// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================================
async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Token inválido' });
        }
        req.user = user;
        next();
    } catch (err) {
        console.error('Error verificando token:', err);
        res.status(500).json({ error: 'Error interno al verificar token' });
    }
}

// Proteger todas las rutas (excepto login y estáticos)
app.use('/buscar-cliente', authenticate);
app.use('/cliente-productos', authenticate);
app.use('/siguiente-recibo', authenticate);
app.use('/guardar-recibo', authenticate);
app.use('/historial', authenticate);
app.use('/agregar-cliente', authenticate);
app.use('/eliminar-cliente', authenticate);
app.use('/reactivar-cliente', authenticate);
app.use('/todas-cobranzas', authenticate);
app.use('/todos-clientes', authenticate);

// ============================================================
// HELPERS DE MAPEO
// ============================================================
const mapearProducto = (p) => ({
    id: p.id,
    ci: p.ci,
    cliente: p.cliente,
    direccion: p.direccion,
    equipo: p.equipo,
    marcaModelo: p.marca_modelo,
    imei: p.imei,
    totalCuotas: p.total_cuotas,
    fechaInicio: p.fecha_inicio,
    fechaFin: p.fecha_fin,
    cuotaMonto: p.cuota_monto,
    montoTotal: p.monto_total,
    activo: p.activo
});

const mapearCobranza = (c) => ({
    id: c.id,
    num_recibo: c.num_recibo,
    ci: c.ci,
    cliente: c.cliente,
    direccion: c.direccion,
    equipo: c.equipo,
    marcaModelo: c.marca_modelo,
    imei: c.imei,
    cuota: c.cuota,
    mes: c.mes,
    estadoCuota: c.estado_cuota,
    montoLiteral: c.monto_literal,
    observaciones: c.observaciones,
    fecha: c.fecha
});

// ============================================================
// RUTAS
// ============================================================

// 1. Buscar cliente por CI (solo activos)
app.get('/buscar-cliente/:ci', async (req, res) => {
    const ci = req.params.ci.trim();
    const { data, error } = await supabase
        .from('productos')
        .select('*')
        .eq('ci', ci)
        .eq('activo', true)
        .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado o inactivo.' });
    }
    res.json(mapearProducto(data[0]));
});

// 2. Todos los productos de un cliente (activos e inactivos)
app.get('/cliente-productos/:ci', async (req, res) => {
    const { ci } = req.params;
    const { data, error } = await supabase
        .from('productos')
        .select('*')
        .eq('ci', ci.trim());
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearProducto));
});

// 3. Siguiente número de recibo
app.get('/siguiente-recibo', async (req, res) => {
    const { data, error } = await supabase
        .from('cobranzas')
        .select('num_recibo')
        .order('num_recibo', { ascending: false })
        .limit(1);
    if (error || !data || data.length === 0) {
        return res.json({ siguiente: '000100' });
    }
    const ultimoNum = parseInt(data[0].num_recibo, 10) || 100;
    const siguiente = String(ultimoNum + 1).padStart(6, '0');
    res.json({ siguiente });
});

// 4. Guardar recibo (cobranza) - CORREGIDO
app.post('/guardar-recibo', async (req, res) => {
    const p = req.body;
    const nuevoRecibo = {
        id: Date.now(),
        num_recibo: p.num_recibo,
        ci: p.ci,
        cliente: p.cliente,
        direccion: p.direccion,
        equipo: p.equipo,
        marca_modelo: p.marcaModelo,
        imei: p.imei,
        cuota: parseFloat(p.cuota) || 0,
        mes: p.mes,
        estado_cuota: p.estadoCuota,
        monto_literal: p.montoLiteral,
        observaciones: p.observaciones,
        fecha: new Date().toISOString()
    };
    const { error } = await supabase.from('cobranzas').insert([nuevoRecibo]);
    if (error) {
        console.error('Error al insertar cobranza:', error);
        return res.status(500).json({ error: error.message });
    }
    res.json({ mensaje: '✅ Pago registrado exitosamente.' });
});

// 5. Historial por CI
app.get('/historial/:ci', async (req, res) => {
    const ci = req.params.ci.trim();
    const { data, error } = await supabase
        .from('cobranzas')
        .select('*')
        .eq('ci', ci)
        .order('fecha', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearCobranza));
});

// 6. Agregar nuevo producto (cliente existente o nuevo)
app.post('/agregar-cliente', async (req, res) => {
    const p = req.body;
    const nuevoProducto = {
        id: Date.now(),
        ci: p.ci,
        cliente: p.cliente,
        direccion: p.direccion,
        equipo: p.equipo,
        marca_modelo: p.marcaModelo,
        imei: p.imei,
        total_cuotas: parseInt(p.totalCuotas) || 0,
        fecha_inicio: p.fechaInicio || null,
        fecha_fin: p.fechaFin || null,
        cuota_monto: parseFloat(p.cuotaMonto) || 0,
        monto_total: parseFloat(p.montoTotal) || 0,
        activo: true,
        fecha_registro: new Date().toISOString()
    };
    const { error } = await supabase.from('productos').insert([nuevoProducto]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({
        mensaje: '✅ Cliente/Producto registrado exitosamente.',
        producto: mapearProducto(nuevoProducto)
    });
});

// 7. Eliminar producto (soft delete)
app.delete('/eliminar-cliente/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { error } = await supabase
        .from('productos')
        .update({ activo: false })
        .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: '✅ Producto marcado como inactivo.' });
});

// 8. Reactivar producto
app.put('/reactivar-cliente/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { error } = await supabase
        .from('productos')
        .update({ activo: true })
        .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: '✅ Producto reactivado exitosamente.' });
});

// 9. Todas las cobranzas (reporte)
app.get('/todas-cobranzas', async (req, res) => {
    const { data, error } = await supabase
        .from('cobranzas')
        .select('*')
        .order('fecha', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearCobranza));
});

// 10. Todos los clientes
app.get('/todos-clientes', async (req, res) => {
    const { data, error } = await supabase
        .from('productos')
        .select('*')
        .order('fecha_registro', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearProducto));
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});