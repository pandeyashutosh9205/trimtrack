const express=require('express');
const app=express();

const PORT=process.env.PORT||3000;

app.get('/',(req,res)=>{
    res.send('trim track is alive');
});

app.listen(PORT,()=>{
    console.log(`sever running on http://localhost:${PORT}`);
});