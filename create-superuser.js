// create-superuser.js - v2.1
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
    console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
    process.exit(1);
}
const supabase = createClient(URL, KEY);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pregunta = (q) => new Promise((res) => rl.question(q, (r) => res(r.trim())));

async function findUserByEmail(email) {
    let page = 1, perPage = 100;
    while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        const found = data.users.find(u => u.email === email);
        if (found) return found;
        if (data.users.length < perPage) return null;
        page++;
    }
}

async function main() {
    console.log('\n🔐 Creación / Actualización de SUPER USUARIO');
    console.log('============================================\n');
    const email = process.env.SUPERUSER_EMAIL || process.argv[2];
    if (!email || !email.includes('@')) {
        console.error('❌ Uso: node create-superuser.js tu@email.com');
        console.error('   O define SUPERUSER_EMAIL en .env');
        process.exit(1);
    }
    console.log(`🔍 Buscando: ${email}`);
    let user = await findUserByEmail(email);
    let userId;
    if (user) {
        console.log(`✅ Encontrado (ID: ${user.id})`);
        userId = user.id;
    } else {
        console.log('⚠️  No existe, creando cuenta nueva...');
        const pw = process.env.SUPERUSER_PASSWORD || await pregunta('🔑 Contraseña (mín. 6): ');
        if (pw.length < 6) {
            console.error('❌ Mínimo 6 caracteres');
            process.exit(1);
        }
        const { data: nu, error } = await supabase.auth.admin.createUser({
            email, password: pw, email_confirm: true
        });
        if (error) { console.error('❌', error.message); process.exit(1); }
        console.log(`✅ Creado (ID: ${nu.user.id})`);
        userId = nu.user.id;
    }
    console.log('\n📝 Asignando rol SUPER_USUARIO...');
    const { data: prof } = await supabase.from('profiles').select('id, role').eq('id', userId).maybeSingle();
    let result;
    if (prof) {
        result = await supabase.from('profiles').update({ role: 'SUPER_USUARIO' }).eq('id', userId);
        console.log('🔄 Perfil actualizado');
    } else {
        result = await supabase.from('profiles').insert([{ id: userId, email, role: 'SUPER_USUARIO' }]);
        console.log('✅ Perfil creado');
    }
    if (result.error) {
        if (!prof) await supabase.auth.admin.deleteUser(userId).catch(() => {});
        console.error('❌', result.error.message);
        process.exit(1);
    }
    console.log(`\n🎉 SUPER USUARIO configurado: ${email}\n`);
    rl.close();
}

main().catch(e => { console.error('Error:', e); process.exit(1); });