// db.js - Cliente dual: usuario (respeta RLS) y admin (ignora RLS)
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error('Falta SUPABASE_URL en .env');
if (!SUPABASE_ANON_KEY) throw new Error('Falta SUPABASE_ANON_KEY en .env');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en .env');

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

// Cliente de usuario: respeta RLS
const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, clientOptions);

// Cliente admin: IGNORA RLS. Solo para operaciones administrativas.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOptions);

module.exports = { supabaseUser, supabaseAdmin, SUPABASE_URL, SUPABASE_ANON_KEY };