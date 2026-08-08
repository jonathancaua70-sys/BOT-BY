const bcrypt = require('bcryptjs');

// Cria hash da senha para o banco de dados
async function createPasswordHash(password) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    console.log(`Senha: ${password}`);
    console.log(`Hash: ${hash}`);
    return hash;
}

// Exemplo de uso
createPasswordHash('admin123').then(() => {
    console.log('\nCopie o hash acima e cole no INSERT do SQL');
    process.exit(0);
});