"use strict";

//объект подключения к хабу
var connection = new signalR.HubConnectionBuilder().withUrl("/WebRTCHub").build();

const configuration = {
    'iceServers': [{
        'urls': 'stun:stun.l.google.com:19302'
    }]
};
const peerConnection = new RTCPeerConnection(configuration);

const roomNameTxt = document.getElementById('roomNameTxt');
const createRoomBtn = document.getElementById('createRoomBtn');
const roomTable = document.getElementById('roomTable');
const connectionStatusMessage = document.getElementById('connectionStatusMessage');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

let myRoomId;
let localStream;
let remoteStream;
let isInitiator = false;
let hasRoomJoined = false;

$(document).ready(() => {
    $('#roomTable').dataTable({
        columns: [
            { data: 'RoomId', "width": "30%" },
            { data: 'Name', "width": "50%" },
            { data: 'Button', "width": "15%" }
        ],
        "lengthChange": false,
        "searching": false,
        "language": {
            "emptyTable": "No room available"
        }
    });
})


grabWebCamVideo();

//подключение к серверу сигнализации
connection.start()
    .then(function (){
        
        connection.on('updateRoom', function (data) {
            const obj = JSON.parse(data);
            $(roomTable).DataTable().clear().rows.add(obj).draw();
        });

        connection.on('created', function (roomId) {
            console.log('Created room', roomId);
            roomNameTxt.disabled = true;
            createRoomBtn.disabled = true;
            hasRoomJoined = true;
            connectionStatusMessage.innerText = 'You created Room ' + roomId + '. Waiting for participants...';
            myRoomId = roomId;
            isInitiator = true;
        });

        connection.on('joined', function (roomId) {
            console.log('This peer has joined room', roomId);
            myRoomId = roomId;
            isInitiator = false;
        });

        connection.on('error', function (message) {
            alert(message);
        });

        connection.on('ready', async function () {
            console.log('Socket is ready');
            roomNameTxt.disabled = true;
            createRoomBtn.disabled = true;
            hasRoomJoined = true;
            connectionStatusMessage.innerText = 'Connecting...';
            await createPeerConnection(isInitiator, configuration);
        });

        connection.on('message', async function (message) {
            console.log('Client received message:', message);
            await signalingMessageCallback(message);
        });

        connection.on('leave', function () {
            console.log(`Peer leaving room.`);
            // If peer did not create the room, re-enter to be creator.
            connectionStatusMessage.innerText = `Other peer left room ${myRoomId}.`;
        });

        window.addEventListener('unload', function () {
            if (hasRoomJoined) {
                console.log(`Unloading window. Notifying peers in ${myRoomId}.`);
                connection.invoke("LeaveRoom", myRoomId).catch(function (err) {
                    return console.error(err.toString());
                });
            }
        });

        //Get room list.
        connection.invoke("GetRoomInfo").catch(function (err) {
            return console.error(err.toString());
        });
    })
    .catch(function (err) {
        return console.error(err.toString());
    });

//Send message to signaling server
function sendMessage(message) {
    console.log('Client sending message: ', message);
    connection.invoke("SendMessage", myRoomId, message).catch(function (err) {
        return console.error(err.toString());
    });
}

/****************************************************************************
 * Room management
 ****************************************************************************/

$(createRoomBtn).click(function () {
    var name = roomNameTxt.value;
    connection.invoke("CreateRoom", name).catch(function (err) {
        return console.error(err.toString());
    });
});

$('#roomTable tbody').on('click', 'button', function () {
    if (hasRoomJoined) {
        alert('You already joined the room. Please use a new tab or window.');
    } else {
        var data = $(roomTable).DataTable().row($(this).parents('tr')).data();
        connection.invoke("Join", data.RoomId).catch(function (err) {
            return console.error(err.toString());
        });
    }
});

function grabWebCamVideo() {
    console.log('Getting user media (video) ...');
    navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
    })
        .then(function(stream){
            console.log('getUserMedia video stream URL:', stream);
            localStream = stream;
            stream.getTracks().forEach((track) => {
                peerConnection.addTrack(track, stream);
            });
            localVideo.srcObject = stream; 
        })
        .catch(function (e) {
            alert('getUserMedia() error: ' + e.name);
        });
}

//Web RTC
var dataChannel;

async function signalingMessageCallback(message) {
    if (message.type === 'offer') {
        console.log('Got offer. Sending answer to peer.');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message));
        await peerConnection.setLocalDescription(await peerConnection.createAnswer());

    } else if (message.type === 'answer') {
        console.log('Got answer.');
        peerConnection.setRemoteDescription(new RTCSessionDescription(message));

    } else if (message.type === 'candidate') {
        peerConnection.addIceCandidate(new RTCIceCandidate({
            candidate: message.candidate
        }));

    }
}

async function createPeerConnection(isInitiator, config) {
    console.log('Creating Peer connection as initiator?', isInitiator, 'config:',
        config);

    // send any ice candidates to the other peer
    peerConnection.onicecandidate = function (event) {
        console.log('icecandidate event:', event);
        if (event.candidate) {
            // Trickle ICE
            //sendMessage({
            //    type: 'candidate',
            //    label: event.candidate.sdpMLineIndex,
            //    id: event.candidate.sdpMid,
            //    candidate: event.candidate.candidate
            //});
            sendMessage(peerConnection.localDescription)
        } else {
            console.log('End of candidates.');
            // Vanilla ICE
            sendMessage(peerConnection.localDescription);
        }
    };

    peerConnection.ontrack = function (event) {
        console.log('icecandidate ontrack event:', event);
        remoteVideo.srcObject = event.streams[0];
    };

    if (isInitiator) {
        console.log('Creating Data Channel');
        dataChannel = peerConnection.createDataChannel('sendDataChannel');
        //onDataChannelCreated(dataChannel);

        console.log('Creating an offer');
        await peerConnection.setLocalDescription(await peerConnection.createOffer());
        console.log('Offer is created')
    } else {
        peerConnection.ondatachannel = function (event) {
            console.log('ondatachannel:', event.channel);
            dataChannel = event.channel;
            //onDataChannelCreated(dataChannel);
        };
    }
}

function onLocalSessionCreated(desc) {
    console.log('Local session created:', desc);
    peerConnection.setLocalDescription(desc);
}

function logError(err) {
    if (!err) return;
    if (typeof err === 'string') {
        console.warn(err);
    } else {
        console.warn(err.toString(), err);
    }
}