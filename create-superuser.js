// create-superuser.js
require('dotenv').config(); // Carga el archivo .env

const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');

// Lee las variables de entorno con diferentes nombres posibles
const SUPABASE_URL = process.env.SUPABASE_URL;
// Busca la clave de servicio en distintas variables
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.service_role;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Faltan variables de entorno:');
    console.error('   Asegúrate de tener definidas en .env:');
    console.error('   - SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY (o service_role)');
    console.error('   Ejemplo:');
    console.error('   SUPABASE_URL=https://tu-proyecto.supabase.co');
    console.error('   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJ...');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function pregunta(pregunta) {
    return new Promise((resolve) => {
        rl.question(pregunta, (respuesta) => resolve(respuesta.trim()));
    });
}

async function main() {
    console.log('\n🔐 Creación / Actualización de SUPER USUARIO');
    console.log('============================================\n');

    const email = 'renetiraque1@gmail.com';

    // 1. Verificar si el usuario ya existe en auth.users
    console.log(`🔍 Buscando usuario con email: ${email} ...`);
    const { data: users, error: searchError } = await supabase.auth.admin.listUsers();
    if (searchError) {
        console.error('❌ Error al listar usuarios:', searchError.message);
        process.exit(1);
    }

    let user = users.users.find(u => u.email === email);
    let userId;

    if (user) {
        console.log(`✅ Usuario encontrado (ID: ${user.id})`);
        userId = user.id;
    } else {
        console.log('⚠️  El usuario no existe en Auth. Se creará una nueva cuenta.');
        const password = await pregunta('🔑 Ingresa la contraseña para el nuevo usuario (mínimo 6 caracteres): ');
        if (password.length < 6) {
            console.error('❌ La contraseña debe tener al menos 6 caracteres.');
            process.exit(1);
        }

        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });
        if (createError) {
            console.error('❌ Error al crear usuario:', createError.message);
            process.exit(1);
        }
        console.log(`✅ Usuario creado con ID: ${newUser.user.id}`);
        userId = newUser.user.id;
    }

    // 2. Asignar rol SUPER_USUARIO en la tabla profiles
    console.log(`\n📝 Asignando rol SUPER_USUARIO al perfil de ${email} ...`);

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', userId)
        .maybeSingle();

    if (profileError && profileError.code !== 'PGRST116') {
        console.error('❌ Error al consultar perfil:', profileError.message);
        process.exit(1);
    }

    let result;
    if (profile) {
        result = await supabase
            .from('profiles')
            .update({ role: 'SUPER_USUARIO' })
            .eq('id', userId);
        console.log('🔄 Perfil actualizado (ya existía)');
    } else {
        result = await supabase
            .from('profiles')
            .insert([{ id: userId, email, role: 'SUPER_USUARIO' }]);
        console.log('✅ Perfil creado');
    }

    if (result.error) {
        console.error('❌ Error al guardar perfil:', result.error.message);
        process.exit(1);
    }

    console.log('\n🎉 ¡SUPER USUARIO configurado correctamente!');
    console.log(`   Email: ${email}`);
    console.log('   Rol: SUPER_USUARIO');
    console.log('\nAhora puedes iniciar sesión en el sistema con todas las capacidades de administrador.\n');

    rl.close();
}

main().catch(err => {
    console.error('Error inesperado:', err);
    process.exit(1);
});