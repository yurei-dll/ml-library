# Websocket standards

Each message between clients and servers is a JSON object. Directory/target properties always start with a `/`.

## Client to server
On first connect, the client sends a "list" command for the "/" folder.

Each request to the server can have the following properties:
- command: the command to execute (e.g. "list", "put", "search")
- target: the directory or file to operate on (e.g. "/foo/bar.txt", "/foo/")

- query: the query string to search for (e.g. "foo") - only used for search

The list command requires the target to end with a slash.

## Server to client
The server responds with a JSON object that could have the following properties:
- objects: an array of objects that are the contents of the directory
    Each object has the following properties:
    - name: the name of the object
    - reference: the reference URL to the object (e.g. "http://192.168.1.2/foo/bar.txt")
    - thumbnail: the thumbnail URL to use, this could be null
- error: when an error occurs, the server returns an error message