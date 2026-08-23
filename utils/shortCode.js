const CHARS='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateShortCode(length=7){
    let code='';
    for(let i=0;i<length;i++){
        const randomIndex=Math.floor(Math.random()*CHARS.length);
        code+=CHARS[randomIndex];
    }

    return code;
}

module.exports={generateShortCode};