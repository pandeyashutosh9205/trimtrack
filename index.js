const express=require('express');
const path=require('path');
const pool=require('./db');
const app=express();

const PORT=process.env.PORT||3000;

app.set('view engine','ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({extended: true}));

app.get('/',(req,res)=>{
    res.render('index');
});

app.listen(PORT,()=>{
    console.log(`sever running on http://localhost:${PORT}`);
});