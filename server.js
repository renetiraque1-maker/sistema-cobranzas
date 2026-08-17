// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Proteger rutas
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
app.use('/cobranza', authenticate);
app.use('/deudores', authenticate);

// ============================================================
// HELPERS
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

// Buscar cliente por CI o nombre
app.get('/buscar-cliente', authenticate, async (req, res) => {
    const { ci, nombre } = req.query;
    let query = supabase.from('productos').select('*').eq('activo', true);
    if (ci) {
        // Validar que CI sea numérico
        if (isNaN(ci.trim())) {
            return res.status(400).json({ error: 'El CI debe ser numérico' });
        }
        query = query.eq('ci', ci.trim());
    } else if (nombre) {
        query = query.ilike('cliente', `%${nombre.trim()}%`);
    } else {
        return res.status(400).json({ error: 'Debe proporcionar ci o nombre' });
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json(data.map(mapearProducto));
});

// Todos los productos de un cliente (activos e inactivos)
app.get('/cliente-productos/:ci', authenticate, async (req, res) => {
    const { ci } = req.params;
    const { data, error } = await supabase
        .from('productos')
        .select('*')
        .eq('ci', ci.trim());
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearProducto));
});

// Siguiente número de recibo
app.get('/siguiente-recibo', authenticate, async (req, res) => {
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

// Guardar recibo
app.post('/guardar-recibo', authenticate, async (req, res) => {
    const p = req.body;
    // Validar que CI sea numérico
    if (isNaN(p.ci)) {
        return res.status(400).json({ error: 'El CI debe ser numérico' });
    }
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
    console.log('📝 Insertando cobranza:', nuevoRecibo);
    const { data, error } = await supabase.from('cobranzas').insert([nuevoRecibo]).select();
    if (error) {
        console.error('❌ Error al insertar cobranza:', error);
        return res.status(500).json({ error: error.message, details: error });
    }
    console.log('✅ Cobranza insertada correctamente:', data);
    res.json({ mensaje: '✅ Pago registrado exitosamente.', data });
});

// Historial por CI
app.get('/historial/:ci', authenticate, async (req, res) => {
    const ci = req.params.ci.trim();
    const { data, error } = await supabase
        .from('cobranzas')
        .select('*')
        .eq('ci', ci)
        .order('fecha', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearCobranza));
});

// Agregar nuevo producto (cliente existente o nuevo)
app.post('/agregar-cliente', authenticate, async (req, res) => {
    const p = req.body;
    // Validar CI numérico
    if (isNaN(p.ci) || p.ci.trim() === '') {
        return res.status(400).json({ error: 'El CI debe ser un número válido' });
    }
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

// Eliminar producto (soft delete)
app.delete('/eliminar-cliente/:id', authenticate, async (req, res) => {
    const id = parseInt(req.params.id);
    const { error } = await supabase
        .from('productos')
        .update({ activo: false })
        .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: '✅ Producto marcado como inactivo.' });
});

// Reactivar producto
app.put('/reactivar-cliente/:id', authenticate, async (req, res) => {
    const id = parseInt(req.params.id);
    const { error } = await supabase
        .from('productos')
        .update({ activo: true })
        .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: '✅ Producto reactivado exitosamente.' });
});

// Todas las cobranzas (reporte)
app.get('/todas-cobranzas', authenticate, async (req, res) => {
    const { data, error } = await supabase
        .from('cobranzas')
        .select('*')
        .order('fecha', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearCobranza));
});

// Todos los clientes
app.get('/todos-clientes', authenticate, async (req, res) => {
    const { data, error } = await supabase
        .from('productos')
        .select('*')
        .order('fecha_registro', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearProducto));
});

// Eliminar cobranza (solo del día actual)
app.delete('/cobranza/:id', authenticate, async (req, res) => {
    const id = parseInt(req.params.id);
    const { data: cobranza, error: getError } = await supabase
        .from('cobranzas')
        .select('fecha')
        .eq('id', id)
        .single();
    if (getError || !cobranza) {
        return res.status(404).json({ error: 'Cobranza no encontrada' });
    }
    const fechaCobranza = new Date(cobranza.fecha);
    const hoy = new Date();
    if (fechaCobranza.toDateString() !== hoy.toDateString()) {
        return res.status(403).json({ error: 'Solo se pueden eliminar registros del día actual' });
    }
    const { error } = await supabase
        .from('cobranzas')
        .delete()
        .eq('id', id);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.json({ mensaje: 'Cobranza eliminada correctamente' });
});

// Deudores del mes
app.get('/deudores', authenticate, async (req, res) => {
    const { mes, anio } = req.query;
    let year = parseInt(anio) || new Date().getFullYear();
    let month = parseInt(mes) || (new Date().getMonth() + 1);
    
    const primerDia = new Date(year, month - 1, 1);
    const ultimoDia = new Date(year, month, 0);
    const fechaInicio = primerDia.toISOString().split('T')[0];
    const fechaFin = ultimoDia.toISOString().split('T')[0];
    
    const { data: productos, error: prodError } = await supabase
        .from('productos')
        .select('*')
        .eq('activo', true);
    if (prodError) return res.status(500).json({ error: prodError.message });
    
    const { data: cobranzas, error: cobError } = await supabase
        .from('cobranzas')
        .select('ci, fecha')
        .gte('fecha', fechaInicio)
        .lte('fecha', fechaFin);
    if (cobError) return res.status(500).json({ error: cobError.message });
    
    const pagaron = new Set(cobranzas.map(c => c.ci));
    const deudores = productos
        .filter(p => !pagaron.has(p.ci))
        .map(mapearProducto);
    res.json(deudores);
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});