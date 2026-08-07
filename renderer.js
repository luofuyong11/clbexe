// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `preload.js` to
// selectively enable features needed in the rendering
// process.

function hideMyCurrentLoading(){
    const rand = parseInt(Math.random()*(15-10)+10)
    setTimeout(()=>{
        document.querySelector(".ant-spin-wrap").style.display = "none"
    },1000*rand)
}

function handleInitLines() {
    const currLine = localStorage.getItem("myLine")
    // let myFrame = document.querySelector(".myFrame")
    let myFrame = {src:''}
    let lineNameEl = document.querySelector(".drop-line-name")
    if (currLine == 1) {
        lineNameEl.innerText = "v7.0线路一"
        myFrame.src = "http://v70.chonglaoban.cn/"
    } else if (currLine == 2) {
        lineNameEl.innerText = "v7.0线路二"
        myFrame.src = "http://v71.chonglaoban.cn/"
    } else if (currLine == 3) {
        lineNameEl.innerText = "v7.0线路三"
        myFrame.src = "http://f7.chonglaoban.cn/"
    } else if (currLine == 4) {
        lineNameEl.innerText = "v6.0线路一"
        myFrame.src = "http://v61.chonglaoban.cn/"
    } else if (currLine == 5) {
        lineNameEl.innerText = "v6.0线路二"
        myFrame.src = "http://v62.renrenchong.com.cn/"
    } else if (currLine == 6) {
        lineNameEl.innerText = "v6.0线路三"
        myFrame.src = "http://f6.chonglaoban.cn/"
    }
    // 
    // else if (currLine == 7) {
    //     lineNameEl.innerText = "测试服70"
    //     myFrame.src = "http://testv63.chonglaoban.com.cn/"
    // }
    // else if (currLine == 8) {
    //     lineNameEl.innerText = "测试服60"
    //     myFrame.src = "http://testv61.chonglaoban.com.cn/"
    // }
    // else if (currLine == 9) {
    //     lineNameEl.innerText = "t66"
    //     myFrame.src = "http://t66.chonglaoban.cn/"
    // }
    // else if (currLine == 10) {
    //     lineNameEl.innerText = "v110"
    //     myFrame.src = "http://v110.chonglaoban.cn/"
    // }
    // else if (currLine == 11) {
    //     lineNameEl.innerText = "localhost"
    //     myFrame.src = "http://localhost:8080"
    // }
    // else if (currLine == 12) {
    //     lineNameEl.innerText = "https-v7.0"
    //     myFrame.src = "https://v70.chonglaoban.cn/"
    // }
    // 
    else if (currLine == 13) {
        lineNameEl.innerText = "v7.0海外线路"
        myFrame.src = "http://ga.chonglaoban.cn/"
    }
    else {
        localStorage.setItem("myLine", "1")
        lineNameEl.innerText = "v7.0线路一"
        myFrame.src = "http://v70.chonglaoban.cn/"
    }
    axios
    .post('http://127.0.0.1:1998/settheline', { line: myFrame.src })
    .then(response => { 
        hideMyCurrentLoading()
    })
    .catch(function (error) {
        console.log(error);
    });
}

function handleInitScale() {
    let currScale = localStorage.getItem("myScale")  

    if(!currScale){currScale=1}   
    const paramNum = currScale
    let scaleNameEl = document.querySelector(".drop-scale-name")   
    
    if(currScale=='-0.75'){currScale = "-50%"}
    else if(currScale=='-0.50'){currScale = "-70%"}
    else if(currScale=='0.25'){currScale = "125%"}
    else if(currScale=='0.50'){currScale = "150%"}
    else{currScale = "100%"}
    scaleNameEl.innerText = currScale  
    axios
    .post('http://127.0.0.1:1998/setscalesize', { op: paramNum })
    .then(response => { })
    .catch(function (error) {
        console.log(error);
    });
}

function handelExpand() {
    let el = document.querySelector(".switch-lines-wrap-bottom-item-sub")
    let iconEl = document.querySelector(".item-drop-icon")
    if (el.style.display == "none") {
        el.style.display = "block"
        iconEl.style.transform = "rotate(180deg)"
    } else {
        el.style.display = "none"
        iconEl.style.transform = "rotate(0deg)"
    }
}

function handelScale(){
    let el = document.querySelector(".switch-scale-wrap-bottom-item-sub")
    let iconEl = document.querySelector(".item-scale-icon")
    if (el.style.display == "none") {
        el.style.display = "block"
        iconEl.style.transform = "rotate(180deg)"
    } else {
        el.style.display = "none"
        iconEl.style.transform = "rotate(0deg)"
    }
}

function sign(obj, url) {
    let arr = Object.keys(obj);
    const sortArr = arr.sort();
    //自定义排序字符串
    let str = sortArr.map(item => `${item}=${obj[item]}`);
    str = str.join("&");
    str = str.replace(/(\r\n|\n|\r)/gm, "")
    const mdStr = hexMD5(str).toString().toUpperCase();
    let code = url.includes("imgApi") ? "code=PCStatic*@%&" : "code=PCRRC&";
    if (url == '/Index/index') {
        code = "code=MrRRC&";
    }
    console.log(mdStr + code)
    return hexMD5(mdStr + code).toString().toUpperCase();
}

function goUpdate(url) {
    axios
        .post('http://127.0.0.1:1998/checkupdate', { appUrl: url })
        .then(response => { })
        .catch(function (error) {
            console.log(error);
        });
}

function checkReadyForUpdate() {
    // const urlPreFixed = "http://testapi.chonglaoban.com.cn/"
    const urlPreFixed = "http://v6.chonglaoban.cn/"
    let objData = {
        act: 'electron_update',
        sys_type: 'pc',
        // version_name:'6.16.0',
        timestamp: parseInt(Date.now() / 1000)
        // iss:1        
    }
    // 
    objData.sign = sign(objData, "/ReUpdateVersion/index")
    axios({
        method: 'post',
        url: `${urlPreFixed}ReUpdateVersion/index`,
        headers: {
            "content-type": "application/x-www-form-urlencoded"
        },
        data: objData
    })
        .then(function (response) {
            console.log(response.data.data)
            if (response.data.data.type == 1) {
                const allVerId = "1.0.0".split('.').join('')
                const incomeVer = response.data.data.version_code.split('.').join('')
                if (Number(incomeVer) > Number(allVerId)) {
                    goUpdate(response.data.data.apk_url)
                }
            }
        })
}

window.onload = function () {
    document.querySelector(".goback").addEventListener("click", function () {
        axios
        .post('http://127.0.0.1:1998/opdirection', { op: 1 })
        .then(response => { })
        .catch(function (error) {
            console.log(error);
        });
    })
    document.querySelector(".gonext").addEventListener("click", function () {
        axios
        .post('http://127.0.0.1:1998/opdirection', { op: 2 })
        .then(response => { })
        .catch(function (error) {
            console.log(error);
        });
    })
    document.querySelector(".freshen").addEventListener("click", function () {
        document.querySelector(".ant-spin-wrap").style.display = "block"
        axios
        .post('http://127.0.0.1:1998/opdirection', { op: 3 })
        .then(response => {
            hideMyCurrentLoading() 
        })
        .catch(function (error) {
            console.log(error);
        });
    })

    document.querySelector(".switch-qh").addEventListener("click", function () {
        document.querySelector(".switch-lines").style.display = "block";
        axios
        .post('http://127.0.0.1:1998/hideorshowview', { op: 0 })
        .then(response => { })
        .catch(function (error) {
            console.log(error);
        });
    })

    document.querySelector(".switch-lines").addEventListener("click", function () {
        axios
        .post('http://127.0.0.1:1998/hideorshowview', { op: 1 })
        .then(response => { })
        .catch(function (error) {
            console.log(error);
        });
        document.querySelector(".switch-lines").style.display = "none";
        document.querySelector(".switch-lines-wrap-bottom-item-sub").style.display = "none"
        document.querySelector(".item-drop-icon").style.transform = "rotate(0deg)"
        document.querySelector(".switch-scale-wrap-bottom-item-sub").style.display = "none"
        document.querySelector(".item-scale-icon").style.transform = "rotate(0deg)"
    })
    document.querySelector(".switch-lines-wrap").addEventListener("click", function (e) {
        e.stopPropagation()
    })

    document.querySelector(".switch-lines-wrap-bottom-item-drop").addEventListener("click", handelExpand)
    document.querySelector(".switch-scale-wrap-bottom-item-drop").addEventListener("click", handelScale)

    handleInitLines()
    handleInitScale()
    window.onkeypress = function (e) {
        console.log(e)
        if (e.ctrlKey && e.code == "KeyD") {
            axios
                .get('http://127.0.0.1:1998/toogledevtool')
                .then(response => {

                })
                .catch(function (error) {
                    console.log(error);
                });

        }
    }
    checkReadyForUpdate()

    window.addEventListener('resize', function(){
       const width = window.innerWidth
       const height = window.innerHeight - 30      
       axios
       .post('http://127.0.0.1:1998/setdevicesize', { width,height })
       .then(response => { })
       .catch(function (error) {
           console.log(error);
       });
    })

}


function chooseLines(line) {
    axios
    .post('http://127.0.0.1:1998/hideorshowview', { op: 1 })
    .then(response => { })
    .catch(function (error) {
        console.log(error);
    });
    localStorage.setItem("myLine", line)
    handleInitLines()

    document.querySelector(".switch-lines-wrap-bottom-item-sub").style.display = "none"
    document.querySelector(".item-drop-icon").style.transform = "rotate(0deg)"
    document.querySelector(".switch-scale-wrap-bottom-item-sub").style.display = "none"
    document.querySelector(".item-scale-icon").style.transform = "rotate(0deg)"
    
    document.querySelector(".switch-lines").style.display = "none";
    document.querySelector(".ant-spin-wrap").style.display = "block"
}

function chooseScale(line) { 
    axios
    .post('http://127.0.0.1:1998/hideorshowview', { op: 1 })
    .then(response => { })
    .catch(function (error) {
        console.log(error);
    });   
    localStorage.setItem("myScale", line)
    handleInitScale()   
    
    document.querySelector(".switch-lines-wrap-bottom-item-sub").style.display = "none"
    document.querySelector(".item-drop-icon").style.transform = "rotate(0deg)"
    document.querySelector(".switch-scale-wrap-bottom-item-sub").style.display = "none"
    document.querySelector(".item-scale-icon").style.transform = "rotate(0deg)"

    document.querySelector(".switch-lines").style.display = "none";    
}

function closeMyapp() {
    axios
        .get('http://127.0.0.1:1998/exitappop')
        .then(response => {

        })
        .catch(function (error) {
            console.log(error);
        });
}

function miniMyapp() {
    axios
        .get('http://127.0.0.1:1998/gohideappop')
        .then(response => {

        })
        .catch(function (error) {
            console.log(error);
        });
}
function toogleMyapp() {
    axios
        .get('http://127.0.0.1:1998/toogleappop')
        .then(response => {

        })
        .catch(function (error) {
            console.log(error);
        });
}




