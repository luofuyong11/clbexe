const http = require('http')
const https = require('https')  
const fs = require('fs')
const path = require('path')
const cluster = require('child_process')
const {dialog} = require('electron')


function prepareToCheckUpdates(appUrl) {
    if(appUrl.indexOf("https")>=0){
        https.get(appUrl, (res) => {
            if (res.statusCode !== "200") {
                const file = fs.createWriteStream(path.join(__dirname) + `${res.req.path.split('/')[res.req.path.split('/').length - 1]}`)
                // 进度
                const len = parseInt(res.headers['content-length']) // 文件总长度
                console.log(len);
                let cur = 0
                res.on('data', function (chunk) {
                    cur += chunk.length
                    const progress = (100.0 * cur / len).toFixed(2) // 当前进度
                    const currProgress = (cur / 1048576).toFixed(2) // 当前了多少
                    //这里开启新的线程启动子窗子 将进度条数据传送至子窗口 显示下载进度。
                    // console.log(progress);
                    // console.log(currProgress + "M");              
                })
                res.on('end', () => {
                    console.log('下载结束')
                    //下载完成执行exe文件
                    ToolsUpgrade(path.join(__dirname) + `${res.req.path.split('/')[res.req.path.split('/').length - 1]}`);
                })
                file.on('finish', () => {
                    // console.log('文件写入结束')
                    file.close()
                }).on('error', (err) => {
                    fs.unlink(path.join(__dirname) + `${res.req.path.split('/')[res.req.path.split('/').length - 1]}`)
                    if (err) {
                        console.log(err)
                    }
                })
                res.pipe(file)
            } else {
                console.log("网络错误!")
            }
        })
    }else{
        http.get(appUrl, (res) => {
            if (res.statusCode !== "200") {
                const file = fs.createWriteStream(path.join(__dirname) + `${res.req.path.split('/')[res.req.path.split('/').length - 1]}`)
                // 进度
                const len = parseInt(res.headers['content-length']) // 文件总长度
                console.log(len);
                let cur = 0
                res.on('data', function (chunk) {
                    cur += chunk.length
                    const progress = (100.0 * cur / len).toFixed(2) // 当前进度
                    const currProgress = (cur / 1048576).toFixed(2) // 当前了多少
                    //这里开启新的线程启动子窗子 将进度条数据传送至子窗口 显示下载进度。
                    // console.log(progress);
                    // console.log(currProgress + "M");              
                })
                res.on('end', () => {
                    console.log('下载结束')
                    //下载完成执行exe文件
                    ToolsUpgrade(path.join(__dirname) + `${res.req.path.split('/')[res.req.path.split('/').length - 1]}`);
                })
                file.on('finish', () => {
                    // console.log('文件写入结束')
                    file.close()
                }).on('error', (err) => {
                    fs.unlink(path.join(__dirname) + `${res.req.path.split('/')[res.req.path.split('/').length - 1]}`)
                    if (err) {
                        console.log(err)
                    }
                })
                res.pipe(file)
            } else {
                console.log("网络错误!")
            }
        })
    }
    

    //调用.exe文件
    function ToolsUpgrade(url) {
        dialog.showMessageBox({message:"新版本已准备好，是否现在安装程序?", title: "更新应用", buttons: ['暂不安装', '安装程序']}).then((value) => {
            if(value.response == 1){
                //重启并安装新版本                                 
                cluster.exec('"' + url + '"', (err, res) => {
                    console.log(err)
                    console.log(res)                     
                })
                setTimeout(()=>{
                    http.get("http://127.0.0.1:1998/exitappop", (res) => {})
                },2000) 
            }
        })
        
        
    }
}



module.exports = prepareToCheckUpdates;