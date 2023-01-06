process.env["FFMPEG_PATH"] = process.env["LAMBDA_TASK_ROOT"] + "/ffmpeg/ffmpeg";
process.env["FFPROBE_PATH"] = process.env["LAMBDA_TASK_ROOT"] + "/ffmpeg/ffprobe";

var AWS = require('aws-sdk'),
    fs = require('fs'),
    zlib = require('zlib'),
    somepath = require('path'),
    async = require('async'),
    ffmpeg = require('fluent-ffmpeg'),
    videoshow = require('videoshow');

ffmpeg.setFfmpegPath(process.env["FFMPEG_PATH"]);
ffmpeg.setFfprobePath(process.env["FFPROBE_PATH"]);

var s3 = new AWS.S3();

function deleteFiles(localPath){
  localPath.map(res => {
    fs.unlink(res, (err) => {
      if (err) throw err;
      console.log(res + ' was deleted');
    });
  })
}

function uploadFile(cb, bucket, filename, key, contentType){
  var readStream = fs.createReadStream(filename),
      gzip = false,
      params = {
        ACL: process.env.S3_BUCKET_ACL,
        Bucket: bucket,
        Key: key,
        ContentType: contentType
      };

	if (gzip) {
		params.Body = readStream.pipe(
			zlib.createGzip({
				level: zlib.Z_BEST_COMPRESSION
			})
		);
		params.ContentEncoding = 'gzip';
	} else {
		params.Body = readStream;
  }
  
	s3.upload(params, function(err, data) {
    if (err) {
        console.log(err);
      //  return err;
    } else {
        console.log(data);
        deleteFile(filename);
    }
  }).on('httpUploadProgress', function(evt) {
	console.log(filename, 'Progress:', evt.loaded, '/', evt.total);
  }).send(cb);

}

function s4() {
  return Math.floor((1 + Math.random()) * 0x10000)
    .toString(16)
    .substring(1);
}

function guid() {
	return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

function plusToSpace(str){
  if(str.includes("+")){
    if(str.includes("/")){
      let arr = str.split("/");
      arr[arr.length - 1] = arr[arr.length - 1].trim().replace(/\+/g, " ");
      str = arr.join("/");
    } else {
      str = str.trim().replace(/\+/g, " ")
    }
  }
  return str;
}

exports.handler = function(event, context) {
    var url = plusToSpace(decodeURIComponent(event.Records[0].s3.object.key)), 
        thumbnailUrl = "VideoThumbnail" + url.slice(url.indexOf("/"), url.lastIndexOf("/") + 1),
        nameOnly = url.slice(url.lastIndexOf("/") + 1, url.lastIndexOf(".")), 
        extension = ".png",
        uuidFilename = guid(), 
        bucket = process.env.S3_BUCKET_NAME, 
        localTempFolder = "/tmp", 
        dimension = '120x90',
        filesList = [],
	filePath = somepath.join(localTempFolder, uuidFilename + (url.slice(url.lastIndexOf("."), url.length))),
	file = fs.createWriteStream(filePath, 'utf8');
	
   file.on('finish', function(){ 
       console.log("File Downloaded");
       ffmpeg(filePath)
                 .on('filenames', function(filenames) {  
                   filesList = filenames.map(res => localTempFolder + "/" + res);
                   console.log('screenshots are: ', filesList);
                 })
                 .on('error', function(err) {
                   console.log('an error happened: ' + err.message);
                 })
                 .on('end', function() {
                   console.log("***** File path: " + filePath);
                   console.log('screenshots were saved');
   
                    let tempArr = [];
                    for(let a = 0; a < filesList.length; a++){
                      if(!fs.existsSync(filesList[a])){
                        console.log("The file: "+filesList[a]+" doesn't exist :-(");
                      } else {
                        tempArr.push(filesList[a]);
                      }
                      
                    }

                    filesList = tempArr;
                    console.log("Files left: ", filesList);
                   if(filesList.length > 0){
			const videoOptions = {
			     loop: 0.5, 
			     transition: false,
			     videoCodec: 'libvpx',
			     size: dimension,
			     format: 'webm'
			}	
			
                      videoshow(filesList, videoOptions).save(localTempFolder + "/" + uuidFilename + '.webm')
                        .on('start', function (command) {
                          console.log('ffmpeg videoshow process started:', command);
                        })
                        .on('error', function (err, stdout, stderr) {
                          console.error('Error:', err)
                          console.error('ffmpeg videoshow stdout:', stdout);
                          console.error('ffmpeg videoshow stderr:', stderr);
                        })
                        .on('end', function (output) {
                          console.error('Video created in:', output);
                          filesList.push(output);
                          console.log(filesList);
      
                          async.parallel(
                            [
                              function (callback) {
                                console.log('uploading webm');
                                uploadFile(callback, bucket, filesList[filesList.length - 1], thumbnailUrl + nameOnly + '.webm', 'video/webm');
                              },
                              function (callback) {
                                console.log('uploading png');
                                uploadFile(callback, bucket, filesList[0], thumbnailUrl + nameOnly + '.png', 'image/png');
                              }
                            ],
                            function (err, results) {
                              if (err){
                                console.log('Uploads failed' + err);
                                console.log(JSON.stringify(results));
                              } else {
                                console.log('Uploads finished', results);
                                filesList.push(filePath);
                                deleteFiles(filesList);
                              }
                            }
                          );
                        })
                    } else {
                      console.log("filesList array is empty :-(");
                    }
                 })
                 .takeScreenshots({ timemarks: [ '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%' ], size: dimension, filename: uuidFilename + '-%i' + extension }, localTempFolder);
   });
   
   file.on('error', function(e){ 
       console.log("Error downloading file", e);
   });
   s3.getObject({ Bucket : bucket, Key: url }).createReadStream().pipe(file);
}




