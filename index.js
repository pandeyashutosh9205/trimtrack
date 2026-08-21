const express=require('express');
const pool=require('./db');
const app=express();

const PORT=process.env.PORT||3000;

app.get('/',async(req,res)=>{
    const result=await pool.query('SELECT NOW()');
    res.send(`trim track is alive. db time: ${result.rows[0].now}`);
});

app.listen(PORT,()=>{
    console.log(`sever running on http://localhost:${PORT}`);
});