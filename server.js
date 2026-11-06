// server.js - v2.1
require('dotenv').config({ path: './.env' });

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { supabaseAdmin, SUPABASE_URL, SUPABASE_ANON_KEY } = require('./db');

// Alias para compatibilidad con rutas existentes
const supabase = supabaseAdmin;

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- SEGURIDAD BÁSICA ----------
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 300,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes, intenta más tarde.' }
});
const adminLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: 30,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiadas operaciones administrativas.' }
});
app.use('/admin/', adminLimiter);
app.use(generalLimiter);

// ---------- AUTH ----------
async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !user) return res.status(401).json({ error: 'Token inválido' });

        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles').select('role').eq('id', user.id).single();
        if (profileError || !profile) return res.status(403).json({ error: 'Usuario sin rol asignado' });

        req.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false }
        });
        req.token = token;
        req.user = { ...user, role: profile.role };
        next();
    } catch (err) {
        console.error('Error verificando token:', err);
        res.status(500).json({ error: 'Error interno al verificar token' });
    }
}

function authorize(roles = []) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        next();
    };
}

// ---------- HELPERS DE SALDOS ----------
async function getCapitalDisponible() {
    const { data: aportes, error: e1 } = await supabase.from('capital_aportes').select('monto');
    if (e1) throw e1;
    const totalAportes = aportes.reduce((s, r) => s + parseFloat(r.monto), 0);
    const { data: prods, error: e2 } = await supabase
        .from('productos').select('capital_utilizado').eq('origen_capital', 'Capital Abonado');
    if (e2) throw e2;
    const totalUsado = prods.reduce((s, r) => s + parseFloat(r.capital_utilizado || 0), 0);
    return totalAportes - totalUsado;
}

async function getGananciaDisponible() {
    const { data: prods, error: e1 } = await supabase
        .from('productos').select('ganancia, capital_utilizado, origen_capital');
    if (e1) throw e1;
    let gt = 0, ur = 0;
    prods.forEach(p => {
        gt += parseFloat(p.ganancia || 0);
        if (p.origen_capital === 'Reinversion') ur += parseFloat(p.capital_utilizado || 0);
    });
    const { data: ret, error: e2 } = await supabase.from('retiros_ganancias').select('monto');
    if (e2) throw e2;
    const tr = ret.reduce((s, r) => s + parseFloat(r.monto), 0);
    return gt - ur - tr;
}

// ---------- HELPERS DE MAPEO ----------
const mapearProducto = (p) => ({
    id: p.id, ci: p.ci, cliente: p.cliente, direccion: p.direccion,
    equipo: p.equipo, marcaModelo: p.marca_modelo, imei: p.imei,
    totalCuotas: p.total_cuotas, fechaInicio: p.fecha_inicio, fechaFin: p.fecha_fin,
    cuotaMonto: p.cuota_monto, montoTotal: p.monto_total, activo: p.activo,
    precioCostoBruto: p.precio_costo_bruto, ganancia: p.ganancia,
    origenCapital: p.origen_capital, capitalUtilizado: p.capital_utilizado
});

const mapearCobranza = (c) => ({
    id: c.id, num_recibo: c.num_recibo, ci: c.ci, cliente: c.cliente,
    direccion: c.direccion, equipo: c.equipo, marcaModelo: c.marca_modelo,
    imei: c.imei, cuota: c.cuota, mes: c.mes, estadoCuota: c.estado_cuota,
    montoLiteral: c.monto_literal, observaciones: c.observaciones, fecha: c.fecha
});

// ---------- RUTAS PÚBLICAS ----------
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ---------- RUTAS PROTEGIDAS ----------
app.get('/buscar-cliente', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const { ci, nombre } = req.query;
    let query = supabase.from('productos').select('*').eq('activo', true);
    if (ci) {
        if (isNaN(ci.trim())) return res.status(400).json({ error: 'El CI debe ser numérico' });
        query = query.eq('ci', ci.trim());
    } else if (nombre) {
        query = query.ilike('cliente', `%${nombre.trim()}%`);
    } else return res.status(400).json({ error: 'Debe proporcionar ci o nombre' });
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(data.map(mapearProducto));
});

app.get('/cliente-productos/:ci', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const { data, error } = await supabase.from('productos').select('*').eq('ci', req.params.ci.trim());
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearProducto));
});

app.get('/siguiente-recibo', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const { data, error } = await supabase.from('cobranzas')
        .select('num_recibo').order('num_recibo', { ascending: false }).limit(1);
    if (error || !data || data.length === 0) return res.json({ siguiente: '000100' });
    const ultimo = parseInt(data[0].num_recibo, 10) || 100;
    res.json({ siguiente: String(ultimo + 1).padStart(6, '0') });
});

app.post('/guardar-recibo', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const p = req.body;
    if (isNaN(p.ci)) return res.status(400).json({ error: 'El CI debe ser numérico' });
    const nuevo = {
        id: Date.now(), num_recibo: p.num_recibo, ci: p.ci, cliente: p.cliente,
        direccion: p.direccion, equipo: p.equipo, marca_modelo: p.marcaModelo,
        imei: p.imei, cuota: parseFloat(p.cuota) || 0, mes: p.mes,
        estado_cuota: p.estadoCuota, monto_literal: p.montoLiteral,
        observaciones: p.observaciones, fecha: new Date().toISOString()
    };
    const { data, error } = await supabase.from('cobranzas').insert([nuevo]).select();
    if (error) { console.error(error); return res.status(500).json({ error: error.message }); }
    res.json({ mensaje: '✅ Pago registrado exitosamente.', data });
});

app.get('/historial/:ci', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const { data, error } = await supabase.from('cobranzas').select('*')
        .eq('ci', req.params.ci.trim()).order('fecha', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearCobranza));
});

app.post('/agregar-cliente', authenticate, authorize(['SUPER_USUARIO']), async (req, res) => {
    const p = req.body;
    if (isNaN(p.ci) || p.ci.trim() === '') return res.status(400).json({ error: 'CI inválido' });
    if (!p.precioCostoBruto || isNaN(p.precioCostoBruto) || parseFloat(p.precioCostoBruto) <= 0)
        return res.status(400).json({ error: 'Precio costo bruto debe ser > 0' });
    if (!['Capital Abonado','Reinversion'].includes(p.origenCapital))
        return res.status(400).json({ error: 'Origen de capital inválido' });
    const montoTotal = parseFloat(p.montoTotal) || 0;
    const costo = parseFloat(p.precioCostoBruto) || 0;
    if (montoTotal <= costo) return res.status(400).json({ error: 'Monto total debe ser mayor que costo' });
    const ganancia = montoTotal - costo;
    if (p.origenCapital === 'Capital Abonado') {
        if ((await getCapitalDisponible()) < costo)
            return res.status(400).json({ error: 'Capital insuficiente' });
    } else {
        if ((await getGananciaDisponible()) < costo)
            return res.status(400).json({ error: 'Ganancia insuficiente' });
    }
    const nuevo = {
        id: Date.now(), ci: p.ci, cliente: p.cliente, direccion: p.direccion,
        equipo: p.equipo, marca_modelo: p.marcaModelo, imei: p.imei,
        total_cuotas: parseInt(p.totalCuotas) || 0,
        fecha_inicio: p.fechaInicio || null, fecha_fin: p.fechaFin || null,
        cuota_monto: parseFloat(p.cuotaMonto) || 0, monto_total: montoTotal,
        activo: true, fecha_registro: new Date().toISOString(),
        precio_costo_bruto: costo, ganancia, origen_capital: p.origenCapital,
        capital_utilizado: costo
    };
    const { error } = await supabase.from('productos').insert([nuevo]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: '✅ Registrado.', producto: mapearProducto(nuevo) });
});

app.delete('/eliminar-cliente/:id', authenticate, authorize(['SUPER_USUARIO']), async (req, res) => {
    const { error } = await supabase.from('productos').update({ activo: false }).eq('id', parseInt(req.params.id));
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: '✅ Inactivado.' });
});

app.put('/reactivar-cliente/:id', authenticate, authorize(['SUPER_USUARIO']), async (req, res) => {
    const { error } = await supabase.from('productos').update({ activo: true }).eq('id', parseInt(req.params.id));
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: '✅ Reactivado.' });
});

app.get('/todas-cobranzas', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const { data, error } = await supabase.from('cobranzas').select('*').order('fecha', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearCobranza));
});

app.get('/todos-clientes', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const { data, error } = await supabase.from('productos').select('*').order('fecha_registro', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.map(mapearProducto));
});

app.delete('/cobranza/:id', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const id = parseInt(req.params.id);
    const { data: c, error: e1 } = await supabase.from('cobranzas').select('fecha').eq('id', id).single();
    if (e1 || !c) return res.status(404).json({ error: 'No encontrada' });
    if (new Date(c.fecha).toDateString() !== new Date().toDateString())
        return res.status(403).json({ error: 'Solo del día actual' });
    const { error } = await supabase.from('cobranzas').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: 'Eliminada' });
});

app.get('/deudores', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const y = parseInt(req.query.anio) || new Date().getFullYear();
    const m = parseInt(req.query.mes) || (new Date().getMonth() + 1);
    const f1 = new Date(y, m - 1, 1).toISOString().split('T')[0];
    const f2 = new Date(y, m, 0).toISOString().split('T')[0];
    const { data: prods, error: e1 } = await supabase.from('productos').select('*').eq('activo', true);
    if (e1) return res.status(500).json({ error: e1.message });
    const { data: cobs, error: e2 } = await supabase.from('cobranzas')
        .select('ci, fecha').gte('fecha', f1).lte('fecha', f2);
    if (e2) return res.status(500).json({ error: e2.message });
    const pagaron = new Set(cobs.map(c => c.ci));
    res.json(prods.filter(p => !pagaron.has(p.ci)).map(mapearProducto));
});

app.get('/perfil', authenticate, async (req, res) => {
    res.json({ role: req.user.role, email: req.user.email });
});

app.get('/resumen-financiero', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    try {
        const { data: ap } = await supabase.from('capital_aportes').select('monto');
        const capitalTotal = ap.reduce((s, r) => s + parseFloat(r.monto), 0);
        const capitalDisponible = await getCapitalDisponible();
        const { data: pr } = await supabase.from('productos').select('ganancia');
        const gananciaTotal = pr.reduce((s, r) => s + parseFloat(r.ganancia || 0), 0);
        const { data: pri } = await supabase.from('productos')
            .select('capital_utilizado').eq('origen_capital', 'Reinversion');
        const totalReinvertido = pri.reduce((s, r) => s + parseFloat(r.capital_utilizado || 0), 0);
        const gananciaDisponible = await getGananciaDisponible();
        const { data: ret } = await supabase.from('retiros_ganancias').select('monto');
        const totalRetirado = ret.reduce((s, r) => s + parseFloat(r.monto), 0);
        res.json({ capitalTotal, capitalDisponible, gananciaTotal, totalReinvertido, gananciaDisponible, totalRetirado });
    } catch (e) { res.status(500).json({ error: 'Error resumen' }); }
});

app.post('/capital/aporte', authenticate, authorize(['SUPER_USUARIO']), async (req, res) => {
    const { inversionista, monto, fecha, observacion } = req.body;
    if (!inversionista || !monto || isNaN(monto) || parseFloat(monto) <= 0 || !fecha)
        return res.status(400).json({ error: 'Campos inválidos' });
    const nuevo = {
        inversionista: inversionista.trim(), monto: parseFloat(monto), fecha,
        observacion: observacion || '', created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('capital_aportes').insert([nuevo]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: '✅ Aporte registrado.', aporte: data[0] });
});

app.get('/capital/aportes', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const { data, error } = await supabase.from('capital_aportes').select('*').order('fecha', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.get('/retiros', authenticate, authorize(['SUPER_USUARIO','USUARIO']), async (req, res) => {
    const { data, error } = await supabase.from('retiros_ganancias').select('*').order('fecha', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/retirar-ganancia', authenticate, authorize(['SUPER_USUARIO']), async (req, res) => {
    const { persona_recibe, monto, fecha, hora, observacion } = req.body;
    if (!persona_recibe || !monto || isNaN(monto) || parseFloat(monto) <= 0 || !fecha || !hora)
        return res.status(400).json({ error: 'Campos inválidos' });
    const disp = await getGananciaDisponible();
    if (disp < parseFloat(monto)) return res.status(400).json({ error: 'Ganancia insuficiente' });
    const codigo = `RET-${fecha.replace(/-/g,'')}-${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
    const nuevo = {
        codigo_unico: codigo, persona_recibe: persona_recibe.trim(), monto: parseFloat(monto),
        fecha, hora, observacion: observacion || '', created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('retiros_ganancias').insert([nuevo]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: '✅ Retiro registrado.', retiro: data[0], saldoAntes: disp, saldoDespues: disp - parseFloat(monto) });
});

// ---------- ADMIN: CREAR USUARIO ----------
app.post('/admin/create-user', authenticate, authorize(['SUPER_USUARIO']), async (req, res) => {
    const { email, password, role } = req.body;
    if (!email || !password || !role) return res.status(400).json({ error: 'Faltan campos' });
    if (!['USUARIO','SUPER_USUARIO'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
    if (password.length < 8) return res.status(400).json({ error: 'Contraseña mínimo 8 caracteres' });
    try {
        const { data: nu, error: ce } = await supabaseAdmin.auth.admin.createUser({
            email, password, email_confirm: true
        });
        if (ce) return res.status(500).json({ error: ce.message });
        const { error: pe } = await supabaseAdmin.from('profiles').insert([{ id: nu.user.id, email, role }]);
        if (pe) {
            await supabaseAdmin.auth.admin.deleteUser(nu.user.id);
            return res.status(500).json({ error: pe.message });
        }
        res.json({ mensaje: 'Usuario creado', user: nu.user, role });
    } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// ---------- ACTUALIZAR CLIENTE ----------
app.put('/actualizar-cliente/:id', authenticate, authorize(['SUPER_USUARIO']), async (req, res) => {
    const id = parseInt(req.params.id);
    const { precioCostoBruto, origenCapital, montoTotal } = req.body;
    if (precioCostoBruto !== undefined && (isNaN(precioCostoBruto) || parseFloat(precioCostoBruto) < 0))
        return res.status(400).json({ error: 'Costo inválido' });
    if (origenCapital && !['Capital Abonado','Reinversion'].includes(origenCapital))
        return res.status(400).json({ error: 'Origen inválido' });
    if (montoTotal !== undefined && (isNaN(montoTotal) || parseFloat(montoTotal) <= 0))
        return res.status(400).json({ error: 'Monto inválido' });
    const { data: actual, error: fe } = await supabase.from('productos').select('*').eq('id', id).single();
    if (fe || !actual) return res.status(404).json({ error: 'No encontrado' });
    const cA = parseFloat(actual.precio_costo_bruto) || 0;
    const mA = parseFloat(actual.monto_total) || 0;
    const oA = actual.origen_capital;
    const nC = precioCostoBruto !== undefined ? parseFloat(precioCostoBruto) : cA;
    const nM = montoTotal !== undefined ? parseFloat(montoTotal) : mA;
    const nO = origenCapital || oA;
    const nG = nM - nC;
    if (nG < 0) return res.status(400).json({ error: 'Monto debe ser mayor a costo' });
    const delta = nC - cA;
    if ((nO !== oA || delta > 0) && delta > 0) {
        if (nO === 'Capital Abonado') {
            const d = await getCapitalDisponible();
            if (d < delta) return res.status(400).json({ error: `Capital insuficiente (disp: ${d.toFixed(2)})` });
        } else {
            const d = await getGananciaDisponible();
            if (d < delta) return res.status(400).json({ error: `Ganancia insuficiente (disp: ${d.toFixed(2)})` });
        }
    }
    const upd = {
        precio_costo_bruto: nC, monto_total: nM, origen_capital: nO,
        ganancia: nG, capital_utilizado: nC
    };
    const { data, error } = await supabase.from('productos').update(upd).eq('id', id).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mensaje: '✅ Actualizado.', producto: mapearProducto(data[0]) });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
});