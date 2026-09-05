// db.js
const { createClient } = require('@supabase/supabase-js');

// Carga variables de entorno (por si no se hizo antes)
require('dotenv').config();

// Intenta obtener la clave de varias formas
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Faltan las variables de entorno SUPABASE_URL y SUPABASE_KEY (o SUPABASE_SERVICE_ROLE_KEY)');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = supabase;