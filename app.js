// Created by ALU52
const fs = require('fs');
const http = require('http');
const ws = require('websocket').server;
const canvas = require('canvas');

// Variables
var imagePrefix = "lib_";
var thumbPrefix = "thumb_";
var maxThumbSize = 325;

//#region Definitions
/**
 * Each folder is actually created within ./media, with a data.json file that stores all the results for each image within it.
 * @typedef {{"name":string,"modified":number,"preview":string"status":"que"|"busy"|"ready"|"error","images":string[],"folders":folder[]}} folder
 */

/**
 * Whats within the data.json files for each folder
 * @typedef {{"filename":string, "results":Object}[]} data
 */
/**
 * 
 * @typedef {{"user":string,"token":string,"address":string,"lastPing":number}} session
 */
//#endregion
// #region Image processing
/**
 * Generates a unique name for the image using the time and a random number
 * @returns {string}
 */
function generateImageName() {
  return imagePrefix + Math.floor(Math.random() * 100000) + "_" + Date.now();
}
/**
 * Explores all the folders within the media folder and returns an array of all image paths
 */
function getImagesIn(path) {
  var images = [];
  fs.readdirSync(path).forEach(file => {
    if (fs.statSync(path + file).isDirectory()) {
      var moreImages = getImagesIn(path + file + "/");
      images = images.concat(moreImages);
    } else if (file.endsWith(".jpg") || file.endsWith(".png")) {
      images.push(path + file);
    }
  });
  return images;
}
getImagesIn("./media/").forEach(image => {
  var imageName = image.split("/").pop();
  var imagePath = image.split("/").slice(0, -1).join("/");
  var fileExtension = imageName.split(".").pop();
  // Ignore the image if it already has the prefix or is a thumbnail
  if (imageName.startsWith(imagePrefix) || imageName.startsWith(thumbPrefix)) { return; }
  // Rename the image
  var newName = generateImageName() + "." + fileExtension;
  fs.renameSync(imagePath + "/" + imageName, imagePath + "/" + newName);
  console.log("Renamed " + imageName + " to " + newName);
  // Check for existing thumbnail
  if (!fs.existsSync(imagePath + "/" + thumbPrefix + newName)) {
    // Generate a thumbnail using canvas while keeping the aspect ratio
    var thumbName = thumbPrefix + newName;
    var thumbPath = imagePath + "/" + thumbName;
    var cvnImage = new canvas.Image();
    cvnImage.src = fs.readFileSync(imagePath + "/" + newName);
    var thumb = new canvas.Canvas(maxThumbSize, maxThumbSize);
    // First check if the image is wider than it is tall
    if (cvnImage.width > cvnImage.height) {
      thumb.width = maxThumbSize;
      thumb.height = Math.floor(maxThumbSize * cvnImage.height / cvnImage.width);
    } else {
      thumb.width = Math.floor(maxThumbSize * cvnImage.width / cvnImage.height);
      thumb.height = maxThumbSize;
    }
    thumb.getContext("2d").drawImage(cvnImage, 0, 0, thumb.width, thumb.height);
    fs.writeFileSync(thumbPath, thumb.toBuffer());
    console.log("Generated thumbnail for " + newName);
  }
});

//#endregion

//#region Connection managers
// Http server for sending files
var httpServer = http.createServer((req, res) => {
  // Having to search for each and every image as they're requested would put too much stress on the server
  // For this reason, all image urls must include the folder they're in, just like the windows explorer
  // eg "https://192.168.1.2/christmas/kidsTogether.png" would fetch the preview for ./media/christmas/kidsTogether.png
  // "https://192.168.1.2/christmas/kidsTogether.png?full=true" would fetch the full-sized image

  // to prevent broken downloads, tokens must be sent with each file requested. Only previews are shared anyway
  // full-sized image downloads will be a separate request
  if (req.url) {
    // Decode the url
    var url = decodeURI(req.url);
    console.log("Requested file: " + url);
    try {
      if (url == "/") {
        res.end(fs.readFileSync("./ui/index.html"));
      } else if (url == "/style.css") {
        res.end(fs.readFileSync("./ui/style.css"));
      } else if (fs.existsSync("./media" + url)) {
        res.end(fs.readFileSync("./media" + url));
      } else {
        // Give a 404
        res.writeHead(404);
      }
    } catch (e) {
      // Universal failsafe
      res.statusCode = 500;
      res.statusMessage = e.message;
      res.end();
    }
  } else {
    // Tell the client they screwed something up
    res.statusCode = 400;
    res.end();
  }
}).listen(8080)
// Websocket server attaches to http server
var wsServer = new ws({
  httpServer: httpServer,
  autoAcceptConnections: false // Enabling this is dangerous
});

wsServer.on('request', function (request) {
  var connection = request.accept(null, request.origin);
  var handleError = (err) => {
    connection.send(JSON.stringify({
      error: err
    }));
  }
  connection.on('message', function (message) {
    console.log('Received message: ' + message.utf8Data);
    if (message.type === 'utf8') {
      // Parse the message
      var msgData;
      try {
        msgData = JSON.parse(message.utf8Data);

        // Request handler
        switch (msgData.command) {
          case "get":

            break;

          case "list":
            // Check the required parameters first
            if (!msgData.target) { handleError("Missing target"); return; }
            // Make sure it starts and ends with a slash
            if (msgData.target[0] != "/" || msgData.target[msgData.target.length - 1] != "/") { handleError("Target must start and end with a slash"); return; }

            // Trim the last character if it's a slash, unless it's the root folder
            if (msgData.target.endsWith("/") && msgData.target != "/") {
              msgData.target = msgData.target.substring(0, msgData.target.length - 1);
            }

            // Read the directory
            var dir = fs.readdirSync("./media" + msgData.target);
            if (!dir) { handleError("Directory not found"); return; }
            var responsePayload = { "objects": [] };
            dir.forEach(file => {
              // If it's a folder, add a slash to the end of the name
              if (fs.lstatSync("./media" + msgData.target + "/" + file).isDirectory()) {
                // Folder
                var slash = msgData.target != "/" ? "/" : "";
                responsePayload.objects.push({
                  "name": file,
                  "reference": msgData.target + slash + file,
                  "type": "folder"
                });
              }
              // If it's a file, add the file extension to the name
              else {
                // Ignore if it's not an image or if its a thumbnail
                if (!file.endsWith(".png") && !file.endsWith(".jpg") && !file.endsWith(".jpeg")) { return; }
                if (file.startsWith(thumbPrefix)) { return; }

                let thumbNailExists = fs.existsSync("./media" + msgData.target + "/" + thumbPrefix + file);
                // Only include a slash between the folder and the file if it's not the root folder
                // If the image has a thumbnail, include a thumbnail url
                var slash = msgData.target != "/" ? "/" : "";
                var fileSize = fs.statSync("./media" + msgData.target + "/" + file).size;
                var payload = {
                  "name": file,
                  "reference": msgData.target + slash + file,
                  "type": "file",
                  "thumbnail": thumbNailExists ? msgData.target + slash + thumbPrefix + file : null,
                  "size": fileSize
                }
                responsePayload.objects.push(payload);
              }
            });
            // Send the payload
            connection.send(JSON.stringify(responsePayload));
            break;

          case "search":

            break;

          default:
            handleError("Unknown command");
            break;
        }
      } catch (error) {
        console.log(error);
        // Let the client know they screwed up
        handleError(error);
        return;
      }
    }
  });
});
//#endregion



// Background operations
setInterval(async () => {
  // Kill inactive sessions - client will have to reload




}, 1000);