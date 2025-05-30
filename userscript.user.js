// ==UserScript==
// @name         Editor Playercount Display
// @version      1.0.1
// @description  Display count and usernames of all online players with this extension in the krunker editor
// @author       ProfessionalNoob
// @match        https://krunker.io/editor.html
// @updateURL    https://github.com/ToxicTryhard/editorplayercount/raw/main/userscript.user.js
// @downloadURL  https://github.com/ToxicTryhard/editorplayercount/raw/main/userscript.user.js
// @supportURL   https://discord.gg/bz8abvq
// @grant        unsafeWindow
// ==/UserScript==

const CONFIG = {
    websocket: {
        reconnect_after_close_delay: 5000,
        url: "wss://www.editor-playercount-display.swatdoge.eu"
    },
    register_interval: 1000,
    max_chat_messages: 50,
    max_message_length: 250
};

const DATA = {
    user: {
        logged_in: false,
        username: null
    },
    playerdata: {
        official_count: 0,
        count: 0,
        players: [],
        positions: []
    },
    chat_message_count: 0,
    ws: null,
    register_interval: null,
    registered: false,
    update_map: null
};

// CSS
const css = `
#pc_container{
    width: fit-content;
    justify-self: end;
    right: 0px;
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 4px;
}

#pc_chat_container{
    position: absolute;
    bottom: 0px;
    width: 400px;
}

#pc_chat_message_container{
    width: 100%;
    max-height: 300px;
    overflow-y: auto;
    padding-bottom: 1px;
}

.pc_box_style{
    padding: 5px;
    margin: 10px;
    border-radius: 4px;
    background-color: rgba(100, 100, 100, 0.5);
    box-shadow: 0px 3px 8px rgba(0, 0, 0, 0.5);
}

.pc_stat{
    height: 18px;
    padding: 2px;
    font-size: 10px;
    color: #fff;
    text-align: left;
    user-select: none;
}

.pc_statTitle{
    height: 18px;
    padding: 2px;
    font-size: 10px;
    color: #ddd;
    text-align: left;
    user-select: none;
}

[id^=chat_message_content_] > * {
    padding: 0px;
}

.pc_link{
    color: #0d3460;
}

.pc_link:hover{
    color: #1d8eb9;
}

.pc_message_element{
    word-wrap: break-word;
}

#pc_playerContainer{
    grid-column: 1 / span 2;
    max-height: 300px;
    overflow-y: auto;
}

#pc_grid_container{
    position: absolute;
    right: 0px;
    pointer-events: none;
}

#canvasInfo{
    position: relative !important;
}

#pc_playerMap{
    aspect-ratio: 1 / 1;
    float: right;
}

.pc_mapBase{
    width: 90%;
    transition: width 750ms ease-in-out;
}

.pc_mapHover{
    width: 200%;
    transition: width 750ms ease-in-out 500ms;
}

.pc_mapCanvas{
    position: absolute;
    right: 0px;
}
`;

// create scene and add dom element to specified container
function create_scene(container){
    const THREE = KE.THREE;

    const anim_speed = 0.0005;
    const texture_path = "https://i.imgur.com/0o2WFto.png";
    const texture_highlights_path = "https://i.imgur.com/BO8Cx0K.png";
    const col_land = "#525252";
    const col_sea = "#242424";
    const col_fresnel = "#444444";
    const fresnelIntensity = 0.0;

    const cubemap_resolution = 512;
    const cubemap_near = 0.5;
    const cubemap_far = 2.0;

    const pos_radius = 0.9;
    const pos_dot_threshold = 0.975;

    // scene
    const scene = new THREE.Scene();
    const scene_positions = new THREE.Scene();

    // renderer
    const renderer = new THREE.WebGLRenderer({alpha: true, antialias: true});
    const resolution = Math.min(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = "srgb";
    renderer.setSize(resolution, resolution);

    // div
    const inner_container = document.createElement("div");
    inner_container.style.cssText = "width: 1px; height: 1px;";
    inner_container.appendChild(renderer.domElement);
    container.appendChild(inner_container);

    renderer.domElement.classList.add("pc_mapCanvas");

    // cubemap setup
    const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(cubemap_resolution);
    const cubeCamera = new THREE.CubeCamera(cubemap_near, cubemap_far, cubeRenderTarget );

    // sphere material
    const geometry = new THREE.SphereGeometry(1, 64, 32);
    const texture = new THREE.TextureLoader().load(texture_path);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const texture_highlights = new THREE.TextureLoader().load(texture_highlights_path);
    texture_highlights.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const material = new THREE.ShaderMaterial({
        uniforms: {
            map: {value: texture},
            map_highlights: {value: texture_highlights},
            cubeMap: {value: cubeRenderTarget.texture},
            col_land: {value: new THREE.Color(col_land)},
            col_sea: {value: new THREE.Color(col_sea)},
            col_fresnel: {value: new THREE.Color(col_fresnel)},
            fresnelIntensity: {value: fresnelIntensity},
        },
        fragmentShader: `
						uniform sampler2D map;
						uniform sampler2D map_highlights;
						uniform vec3 col_land;
						uniform vec3 col_sea;
						uniform vec3 col_fresnel;
						uniform float fresnelIntensity;
						uniform samplerCube cubeMap;

						varying vec4 vCubePosition;
						varying vec2 vUv;
						varying vec3 vPosition;
						varying vec3 vNormal;

						void main() {
							float fresnelTerm = abs(dot(vPosition, normalize(vNormal)));
							vec3 cubeCol = textureCube(cubeMap, vCubePosition.xyz).rgb;
							gl_FragColor = vec4(
								cubeCol.g < 1.0 ? mix(
									mix(
										col_sea,
										max(col_land, vec3(texture2D(map_highlights, vUv.xy).r * cubeCol.r)),
										texture2D(map, vUv.xy).r
									),
									col_fresnel,
									(1.0 - fresnelTerm) * fresnelIntensity
								) :
								vec3(1.0),
								1.0
							);
						}
					`,
        vertexShader: `
						varying vec2 vUv;
						varying vec3 vPosition;
						varying vec3 vNormal;
						varying vec4 vCubePosition;

						void main() {
							vUv = uv;
							vPosition = normalize(vec3(modelViewMatrix * vec4(vec3(0.0), 1.0)).xyz);
							vCubePosition = modelMatrix * vec4(position, 1.0);
							vNormal = normalize(normalMatrix * normal);
							gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
						}
					`
    });

    // sphere
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    // pivot
    const pivot = new THREE.Group();
    pivot.name = "pivot";
    scene.add(pivot);

    // camera
    const camera = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0, 4);
    camera.position.z = 2;
    pivot.add(camera);
    onContainerResize();

    // render camera
    function animate(){
        requestAnimationFrame(animate);

        pivot.rotation.y = performance.now() * anim_speed;
        renderer.render(scene, camera);
    }

    animate();

    // container resize
    function onContainerResize(){
        const resolution = Math.min(container.clientWidth, container.clientHeight);
        renderer.setSize(resolution, resolution);
        renderer.render(scene, camera);
    }

    new ResizeObserver(onContainerResize).observe(container);

    // spherical to cartesian
    function convert_coords(x, y){
        const theta = -x + (Math.PI / 2);
        const phi = y - (Math.PI / 2);

        return {
            x: Math.sin(phi) * Math.cos(theta),
            y: Math.cos(phi),
            z: Math.sin(phi) * Math.sin(theta)
        };
    }

    // deg to rad
    function degToRad(deg){
        return deg * (Math.PI / 180);
    }

    // positions
    const pos_geo = new THREE.PlaneGeometry(pos_radius, pos_radius); //new THREE.SphereGeometry(pos_radius, 12, 6);
    const pos_mat = new THREE.ShaderMaterial({
        uniforms: {
            pos_radius: {value: pos_radius},
            pos_dot_threshold: {value: pos_dot_threshold}
        },
        fragmentShader: `
						uniform float pos_radius;
						uniform float pos_dot_threshold;
                        varying vec2 vUv;

						void main() {
							float dist = 1.0 - clamp(length(vUv - vec2(0.5)) * 2.0, 0.0, 1.0);
							gl_FragColor = vec4(
								pow(dist, 0.5),
								dist > pos_dot_threshold ? 1.0 : 0.0, 0.0, 1.0);
						}
					`,
        vertexShader: `
						varying vec2 vUv;

						void main() {
							vUv = uv;
							gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
						}
					`
    });

    return function(positions){
        const position_objects = [];

        // create objects for positions
        if(positions){
            positions.forEach((position) => {
                const new_position = convert_coords(degToRad(position.y) - (Math.PI * 0.5), degToRad(position.x));
                const pos_object = new THREE.Mesh(pos_geo, pos_mat);
                pos_object.position.x = new_position.x;
                pos_object.position.y = new_position.y;
                pos_object.position.z = new_position.z;
                scene_positions.add(pos_object);
                pos_object.lookAt(0, 0, 0);
                position_objects.push(pos_object);
            });
        }

        // render positions to cubemap
        cubeCamera.update( renderer, scene_positions );

        // delete position spheres
        position_objects.forEach((pos_object) => {
            scene_positions.remove(pos_object);
        });
    };
}

// Else

function addCss(){
    const style = document.createElement("style");

    if(style.styleSheet){
        style.styleSheet.cssText = css;
    }else{
        style.appendChild(document.createTextNode(css));
    }

    document.getElementsByTagName("head")[0].appendChild(style);
}

// Functions
function getInitMessage(){
    return JSON.stringify({
        header: "init",
        logged_in: DATA.user.logged_in,
        username: DATA.user.username
    });
}

function sendPlayerdata(){
    if(!DATA.ws){
        return;
    }

    if(!DATA.registered){
        DATA.registered = true;
        DATA.ws.send(getInitMessage());
    }else if(KE.account){
        DATA.user.logged_in = true;
        DATA.user.username = KE.account.name;
        DATA.ws.send(getInitMessage());

        clearInterval(DATA.register_interval);
    }
}

function updatePCDisplay(){
    const pc_container = document.getElementById("pc_container");

    if(pc_container){
        const pc_official_count = DATA.playerdata.official_count;
        const pc_count = DATA.playerdata.count;
        const pc_logged_count = DATA.playerdata.players.length;

        pc_container.querySelector("#pc_official_stat").innerText = pc_official_count;
        pc_container.querySelector("#pc_logged_stat").innerText = pc_logged_count + " / " + pc_count;

        const pc_player_container = pc_container.querySelector("#pc_playerContainer");
        pc_player_container.innerHTML = "";

        DATA.playerdata.players.forEach((player, i) => {
            addDivChild(pc_player_container, "pc_player_" + i, "pc_stat", player.username);
        });
        DATA.update_map(DATA.playerdata.positions);
    }
}

function addChatMessage(username, content){
    const chat_message_container = document.getElementById("pc_chat_message_container");
    if(chat_message_container){
        const message_id = DATA.chat_message_count;
        const message_container = addDivChild(chat_message_container, "chat_message_" + message_id, null, null);
        const message_user = addDivChild(message_container, "chat_message_user_" + message_id, "pc_statTitle pc_message_element", null, "span");
        message_user.innerText = username + ":";

        const message_content = addDivChild(message_container, "chat_message_content_" + message_id, "pc_stat pc_message_element", null, "span");

        const regex_link = /(?:(?:https?|http):\/\/)?[\w/\-?=%.]+\.[\w/\-&?=%#]+/gi;
        const regex_https = /(https|http):\/\//gi;
        const texts = content.split(regex_link);
        const links = content.match(regex_link);

        for(let i = 0; i < texts.length; i++){
            const text_element = addDivChild(message_content, null, "pc_stat", null, "span");
            text_element.innerText = texts[i];
            if(links && links.length > i){
                let link = links[i];
                const hasHttps = regex_https.test(link)

                if (!hasHttps) {
                    link = "https://" + link;
                }

                const link_element = addDivChild(message_content, null, "pc_stat pc_link", null, "a");
                link_element.innerText = link;
                link_element.href = link;
                link_element.target = "_blank";
                link_element.rel="noopener noreferrer";
            }
        }

        while(chat_message_container.children.length > CONFIG.max_chat_messages){
            chat_message_container.children[0].remove();
        }

        chat_message_container.scrollTop = chat_message_container.scrollHeight;

        DATA.chat_message_count++;
    }
}

function parseMessage(messageEvent){
    const message = JSON.parse(messageEvent.data);
    switch(message.header){
        case "count":
            DATA.playerdata.official_count = message.official_count;
            DATA.playerdata.count = message.count;
            DATA.playerdata.players = message.users;
            DATA.playerdata.positions = message.positions;
            updatePCDisplay();
            break;
        case "chat":
            addChatMessage(message.username, message.message);
            break;
        case "recovery":
            message.messages.forEach((msg) => addChatMessage(msg.username, msg.message));
            break;
    }
}

function startWebsocket(){
    // Create ws
    const ws = new WebSocket(CONFIG.websocket.url);
    DATA.ws = ws;

    // Send playerdata interval
    if(DATA.register_interval){
        clearInterval(DATA.register_interval);
    }
    DATA.registered = false;
    DATA.register_interval = setInterval(sendPlayerdata, CONFIG.register_interval);

    // WS functions
    DATA.ws.onmessage = parseMessage;

    DATA.ws.onclose = function(){
        DATA.ws = null;
        setTimeout(startWebsocket, CONFIG.websocket.reconnect_after_close_delay);
    }
}

function addDivChild(parent, id, css_class, inner_text, type = "div"){
    const new_div = document.createElement(type);
    if(id){
        new_div.id = id;
    }
    new_div.innerText = inner_text;
    if(css_class){
        const classes = css_class.split(" ");
        new_div.classList.add(...classes);
    }
    parent.appendChild(new_div);

    return new_div;
}

function sendChatMessage(content){
    content = content.trim();
    if(content.length > 0 && content.length <= CONFIG.max_message_length && DATA.ws){
        DATA.ws.send(
            JSON.stringify({
                header: "chat",
                message: content
            })
        );
    }
}

function createUI(center_div){
    // playercount
    const grid_container = addDivChild(center_div, "pc_grid_container", null, null);
    const stats_div = document.getElementById("canvasInfo");
    grid_container.appendChild(stats_div);

    const playercount_container = addDivChild(grid_container, "pc_container", "pc_box_style", null);

    addDivChild(playercount_container, "pc_official_title", "pc_statTitle", "Official:");
    addDivChild(playercount_container, "pc_official_stat", "pc_stat", "0");
    addDivChild(playercount_container, "pc_logged_title", "pc_statTitle", "Logged in:");
    addDivChild(playercount_container, "pc_logged_stat", "pc_stat", "0 / 0");
    addDivChild(playercount_container, "pc_playerContainer", null, null);


    // Three
    const map_container = addDivChild(grid_container, "pc_playerMap", null, null);
    map_container.classList.add("pc_mapBase");
    DATA.update_map = create_scene(map_container);

    unsafeWindow.update_map = DATA.update_map;

    updatePCDisplay();

    // resize on hover
    window.addEventListener("mousemove", (e) => {
        const rect = map_container.getBoundingClientRect();

        if(
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom
        ){
            map_container.classList.add("pc_mapHover");
        }else{
            map_container.classList.remove("pc_mapHover");
        }
    });

    // chatbox
    document.getElementById("canvasObjEdit").remove();
    const chat_container = addDivChild(center_div, "pc_chat_container", "pc_box_style", null);
    const chat_message_container = addDivChild(chat_container, "pc_chat_message_container", null, null);
    const chat_input = addDivChild(chat_container, "pc_chat_input", "inlineInput", null, "input");

    chat_input.maxLength = CONFIG.max_message_length;
    chat_input.onkeydown = function(e){
        if(e.code === "Enter"){
            sendChatMessage(e.target.value);
            e.target.value = "";
        }

        e.stopPropagation();
    };

    chat_input.placeholder = "Enter Message";
}

function start(){
    addCss();

    const element = document.body;
    chatObserver.observe(element, {childList: true, subtree: true});

    startWebsocket();
}

// UI
const chatObserver = new MutationObserver((mutations) => {
    const center_div = document.getElementById("center");

    if(center_div){
        createUI(center_div);

        chatObserver.disconnect();
    }
});

// Start
start();
