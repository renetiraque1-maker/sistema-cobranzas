const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Faltan las variables de entorno SUPABASE_URL y SUPABASE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = supabase;