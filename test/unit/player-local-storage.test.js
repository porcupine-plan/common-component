import LocalMessaging from "../../local-messaging";
import PlayerLocalStorage from "../../player-local-storage";

describe("PlayerLocalStorage", () => {
  let playerLocalStorage = null;
  let localMessaging = null;
  let eventHandler = null;

  function mockViewerLocalMessaging(connected) {
    top.RiseVision = {};
    top.RiseVision.Viewer = {};
    top.RiseVision.Viewer.LocalMessaging = {
      canConnect: () => {return connected;}
    };

    top.RiseVision.Viewer.LocalMessaging.write = jest.genMockFn();
    top.RiseVision.Viewer.LocalMessaging.receiveMessages = jest.genMockFn();
  }

  beforeEach(() => {
    mockViewerLocalMessaging(true);
    eventHandler = jest.genMockFn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should execute no-connection event on event handler when no LM client connection", ()=> {
      mockViewerLocalMessaging(false);

      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      expect(eventHandler).toHaveBeenCalledWith({
        "event": "no-connection"
      })
    });

    it("should send client list request when LM client connection", ()=> {
      mockViewerLocalMessaging(true);

      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      expect(eventHandler).toHaveBeenCalledTimes(0);
      expect(top.RiseVision.Viewer.LocalMessaging.write).toHaveBeenCalledWith({
        "topic": "client-list-request"
      });
    });
  });

  describe("_handleMessage()", () => {

    beforeEach(() => {
      jest.useFakeTimers();
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);
    });

    afterEach(() => {
      jest.clearAllTimers();
    });

    describe("CLIENT-LIST", () => {
      it("should send STORAGE-LICENSING-REQUEST  when required modules are present", () => {
        const message = {
          "topic": "client-list",
          "clients": ["local-messaging", "player-electron", "local-storage", "licensing", "logger"]
        };

        top.RiseVision.Viewer.LocalMessaging.write.mockClear();
        playerLocalStorage._handleMessage(message);

        expect(top.RiseVision.Viewer.LocalMessaging.write).toHaveBeenCalledWith({
          "topic": "storage-licensing-request"
        });
      });

      it("should not send STORAGE-LICENSING-REQUEST when receiving message again and modules are available", () => {
        const message = {
          "topic": "client-list",
          "clients": ["local-messaging", "player-electron", "local-storage", "licensing", "logger"]
        };

        top.RiseVision.Viewer.LocalMessaging.write.mockClear();
        playerLocalStorage._handleMessage(message);
        playerLocalStorage._handleMessage(message);
        playerLocalStorage._handleMessage(message);

        expect(top.RiseVision.Viewer.LocalMessaging.write).toHaveBeenCalledTimes(1);
      });

      it("should send CLIENT-LIST-REQUEST 30 more times every 1 second before executing required-modules-unavailable event on event handler", () => {
        const message = {
          "topic": "client-list",
          "clients": ["local-messaging", "player-electron", "logger"]
        };

        top.RiseVision.Viewer.LocalMessaging.write.mockClear();
        playerLocalStorage._handleMessage(message);
        jest.advanceTimersByTime(1000);
        expect(eventHandler).toHaveBeenCalledTimes(0);
        expect(top.RiseVision.Viewer.LocalMessaging.write).toHaveBeenCalledWith({
          "topic": "client-list-request"
        });

        // mock 30 more client-list messages sent/received
        for (let i = 30; i > 0; i--){
          playerLocalStorage._handleMessage(message);
          jest.advanceTimersByTime(1000);
        }

        expect(eventHandler).toHaveBeenCalledWith({
          "event": "required-modules-unavailable"
        })
      });
    });

    describe("STORAGE-LICENSING-UPDATE", () => {
      beforeEach(()=>{
        eventHandler.mockClear();
      });

      it("should update authorization and execute 'licensing' event on event handler", () => {
        const message = {
          "from": "storage-module",
          "topic": "storage-licensing-update",
          "isAuthorized": false,
          "userFriendlyStatus": "unauthorized"
        };

        playerLocalStorage._handleMessage(message);

        expect(playerLocalStorage.isAuthorized()).toBeFalsy();
        expect(eventHandler).toHaveBeenCalledWith({
          "event": "unauthorized"
        });

        message.isAuthorized = true;
        message.userFriendlyStatus = "authorized";
        eventHandler.mockClear();

        playerLocalStorage._handleMessage(message);

        expect(playerLocalStorage.isAuthorized()).toBeTruthy();
        expect(eventHandler).toHaveBeenCalledWith({
          "event": "authorized"
        });
      });

      it("should not update authorization or execute event on handler if authorization hasn't changed", () => {
        const message = {
          "from": "storage-module",
          "topic": "storage-licensing-update",
          "isAuthorized": true,
          "userFriendlyStatus": "authorized"
        };

        expect(playerLocalStorage.isAuthorized()).toBeNull();

        playerLocalStorage._handleMessage(message);

        expect(playerLocalStorage.isAuthorized()).toBeTruthy();
        expect(eventHandler).toHaveBeenCalledTimes(1);

        playerLocalStorage._handleMessage(message);
        expect(playerLocalStorage.isAuthorized()).toBeTruthy();
        expect(eventHandler).toHaveBeenCalledTimes(1);

      });
    });

    describe("FILE-UPDATE", () => {
      beforeEach(()=>{
        const message = {
          "from": "storage-module",
          "topic": "storage-licensing-update",
          "isAuthorized": true,
          "userFriendlyStatus": "authorized"
        };

        playerLocalStorage._handleMessage(message);
        eventHandler.mockClear();
      });

      it("should not execute if 'message' does not contain required props", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update"
        };

        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);

        message.filePath = "test.png";

        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);

        message.status = "noexist";

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(1);

      });

      it("should not execute if message pertains to a file not being watched", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "non-watched-file.png",
          "status": "stale"
        };

        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should execute 'file-available' event on event handler when message status is CURRENT", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test.png",
          "status": "current",
          "ospath": "rvplayer/modules/local-storage/xxxx/cache/ABC123",
          "osurl": "file:///rvplayer/modules/local-storage/xxxx/cache/ABC123"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-available",
          filePath: message.filePath,
          fileUrl: message.osurl
        });
      });

      it("should not execute any event on event handler when watched file status is same as new status", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test.png",
          "status": "current",
          "ospath": "rvplayer/modules/local-storage/xxxx/cache/ABC123",
          "osurl": "rvplayer/modules/local-storage/xxxx/cache/ABC123"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(1);

        eventHandler.mockClear();

        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should execute 'file-processing' event on event handler when status is STALE", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test.png",
          "status": "stale"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-processing",
          filePath: "test.png"
        });
      });

      it("should execute event on handler when message pertains to file not being watched but is from a watched folder", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test-bucket/test-folder/watched-folder-test-file.png",
          "status": "stale"
        };

        playerLocalStorage.watchFiles("test-bucket/test-folder/");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-processing",
          filePath: "test-bucket/test-folder/watched-folder-test-file.png"
        });
      });

      it("should execute event on handler when message pertains to file being watched and is valid file type", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test-bucket/test-folder/test-image-file.png",
          "status": "stale"
        };

        playerLocalStorage.watchFiles("test-bucket/test-folder/", "image");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-processing",
          filePath: "test-bucket/test-folder/test-image-file.png"
        });
      });

      it("should not execute event on handler when message pertains to file not being watched and is not from a watched folder", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test-bucket/test-folder-2/unwatched-folder-test-file.png",
          "status": "stale"
        };

        playerLocalStorage.watchFiles("test-bucket/test-folder/");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should not execute event on handler when message pertains to file being watched but is not a valid file type", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test-bucket/test-folder/test-image-file.png",
          "status": "stale"
        };

        playerLocalStorage.watchFiles("test-bucket/test-folder/", "video");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should execute 'storage-file-no-exist' event on event handler when status is NOEXIST", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test.png",
          "status": "noexist"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-no-exist",
          filePath: "test.png"
        });
      });

      it("should execute 'storage-file-deleted' event on event handler when status is DELETED", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test.png",
          "status": "deleted"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-deleted",
          filePath: "test.png"
        });
      });
    });

    describe("FILE-ERROR", () => {
      beforeEach(()=>{
        const message = {
          "from": "storage-module",
          "topic": "storage-licensing-update",
          "isAuthorized": true,
          "userFriendlyStatus": "authorized"
        };

        playerLocalStorage._handleMessage(message);
        eventHandler.mockClear();
      });

      it("should not execute if 'message' does not contain filePath prop", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-error"
        };

        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should not execute if message pertains to a file not being watched", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-error",
          "filePath": "non-watched-file.png",
          "msg": "Insufficient disk space"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should execute 'file-error' event on event handler", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-error",
          "filePath": "test.png",
          "msg": "Could not retrieve signed URL",
          "detail": "Some response details"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-error",
          filePath: message.filePath,
          msg: message.msg,
          detail: message.detail
        });
      });

      it("should execute 'file-error' event on event handler when message pertains to file not being watched but is from a watched folder", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-error",
          "filePath": "test-bucket/test-folder/watched-folder-test-file.png",
          "msg": "Could not retrieve signed URL",
          "detail": "Some response details"
        };

        playerLocalStorage.watchFiles("test-bucket/test-folder/");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-error",
          filePath: message.filePath,
          msg: message.msg,
          detail: message.detail
        });
      });

      it("should execute 'file-error' event on event handler when message pertains to file watched and is valid file type", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-error",
          "filePath": "test-bucket/test-folder/test-image-file.png",
          "msg": "Could not retrieve signed URL",
          "detail": "Some response details"
        };

        playerLocalStorage.watchFiles("test-bucket/test-folder/", "image");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-error",
          filePath: message.filePath,
          msg: message.msg,
          detail: message.detail
        });
      });

      it("should not execute event on handler when message pertains to file not being watched and is not from a watched folder", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-error",
          "filePath": "test-bucket/test-folder-2/unwatched-folder-test-file.png",
          "msg": "Could not retrieve signed URL",
          "detail": "Some response details"
        };

        playerLocalStorage.watchFiles("test-bucket/test-folder/");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should not execute event on handler when message pertains to file being watched but is not a valid file type", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-error",
          "filePath": "test-bucket/test-folder/test-image-file.png",
          "msg": "Could not retrieve signed URL",
          "detail": "Some response details"
        };

        playerLocalStorage.watchFiles("test-bucket/test-folder/", "video");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });
    });
  });

  describe("_isFolderPath()", () => {
    beforeEach(()=>{
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const message = {
        "from": "storage-module",
        "topic": "storage-licensing-update",
        "isAuthorized": true,
        "userFriendlyStatus": "authorized"
      };
      playerLocalStorage._handleMessage(message);
    });

    it("should return true", () => {
      expect(playerLocalStorage._isFolderPath("test-bucket/test-folder/")).toBeTruthy();
    });

    it("should return false", () => {
      expect(playerLocalStorage._isFolderPath("test-bucket/test-file.png")).toBeFalsy();
    });

  });

  describe("_isValidFileType()", () => {
    beforeEach(()=>{
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const message = {
        "from": "storage-module",
        "topic": "storage-licensing-update",
        "isAuthorized": true,
        "userFriendlyStatus": "authorized"
      };
      playerLocalStorage._handleMessage(message);
    });

    it("should return true for a valid image file", () => {
      playerLocalStorage._setFileType("image");

      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.jpg")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.jpeg")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.png")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.bmp")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.svg")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.gif")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.webp")).toBeTruthy();
    });

    it("should return true for a valid video file", () => {
      playerLocalStorage._setFileType("video");

      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.webm")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.mp4")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.ogv")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.ogg")).toBeTruthy();
    });

    it("should return false for an invalid image file", () => {
      playerLocalStorage._setFileType("image");

      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.jpg.webm")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.webm")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.mp4")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.ogv")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.ogg")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.html")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.js")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.css")).toBeFalsy();
    });

    it("should return false for an invalid video file", () => {
      playerLocalStorage._setFileType("video");

      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.webm.jpg")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.jpg")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.jpeg")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.png")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.bmp")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.svg")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.gif")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.webp")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.html")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.js")).toBeFalsy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.css")).toBeFalsy();
    });

    it("should return true when no filter file type set", () => {
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.jpg")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.webm")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.png")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.mp4")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.svg")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.gif")).toBeTruthy();
      expect(playerLocalStorage._isValidFileType("test-bucket/test-file.html")).toBeTruthy();
    });
  });

  describe("_watchFile()", () => {
    beforeEach(()=>{
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const message = {
        "from": "storage-module",
        "topic": "storage-licensing-update",
        "isAuthorized": true,
        "userFriendlyStatus": "authorized"
      };
      playerLocalStorage._handleMessage(message);
    });

    it("should broadcast WATCH of single file", () => {
      playerLocalStorage._watchFile("test.png");

      expect(top.RiseVision.Viewer.LocalMessaging.write).toHaveBeenCalledWith({
        "topic": "WATCH",
        "filePath": "test.png"
      });
    });
  });

  describe("_watchFolder()", () => {
    beforeEach(()=>{
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const message = {
        "from": "storage-module",
        "topic": "storage-licensing-update",
        "isAuthorized": true,
        "userFriendlyStatus": "authorized"
      };
      playerLocalStorage._handleMessage(message);
    });

    it("should broadcast WATCH of a folder", () => {
      playerLocalStorage._watchFolder("test-bucket/test-folder/");

      expect(top.RiseVision.Viewer.LocalMessaging.write).toHaveBeenCalledWith({
        "topic": "WATCH",
        "filePath": "test-bucket/test-folder/"
      });
    });
  });

  describe("watchFiles()", () => {

    it("should not execute if filePaths params is falsy", () => {
      mockViewerLocalMessaging(false);
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const spyFile = jest.spyOn(playerLocalStorage, '_watchFile');
      const spyFolder = jest.spyOn(playerLocalStorage, '_watchFolder');

      playerLocalStorage.watchFiles("");

      expect(spyFile).toHaveBeenCalledTimes(0);
      expect(spyFolder).toHaveBeenCalledTimes(0);

      spyFile.mockReset();
      spyFile.mockRestore();
      spyFolder.mockReset();
      spyFolder.mockRestore();
    });

    it("should not execute if not connected", () => {
      mockViewerLocalMessaging(false);
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const spy = jest.spyOn(playerLocalStorage, '_watchFile');

      playerLocalStorage.watchFiles(["test1.png", "test2.png"]);

      expect(spy).toHaveBeenCalledTimes(0);

      spy.mockReset();
      spy.mockRestore();
    });

    it("should not execute if not authorized", () => {
      mockViewerLocalMessaging(true);
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const message = {
        "from": "storage-module",
        "topic": "storage-licensing-update",
        "isAuthorized": false,
        "userFriendlyStatus": "unauthorized"
      };

      const spy = jest.spyOn(playerLocalStorage, '_watchFile');

      playerLocalStorage._handleMessage(message);

      playerLocalStorage.watchFiles(["test1.png", "test2.png"]);

      expect(spy).toHaveBeenCalledTimes(0);

      spy.mockReset();
      spy.mockRestore();
    });

    it("should watch one single file provided as a param string", () => {
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const message = {
        "from": "storage-module",
        "topic": "storage-licensing-update",
        "isAuthorized": true,
        "userFriendlyStatus": "authorized"
      };

      const spy = jest.spyOn(playerLocalStorage, '_watchFile');

      playerLocalStorage._handleMessage(message);
      playerLocalStorage.watchFiles("test.png");

      expect(spy).toHaveBeenCalledWith("test.png");

      spy.mockReset();
      spy.mockRestore();
    });

    it("should start watching multiple single files", () => {
      const spy = jest.spyOn(playerLocalStorage, '_watchFile');

      playerLocalStorage.watchFiles(["test1.png", "test2.png"]);

      expect(spy).toHaveBeenCalledTimes(2);

      spy.mockReset();
      spy.mockRestore();
    });

    it("should only send watch of single files that aren't already being watched", () => {
      const spy = jest.spyOn(playerLocalStorage, '_watchFile');

      playerLocalStorage.watchFiles(["test.png", "test1.png", "test2.png", "test3.png"]);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("test3.png");

      spy.mockReset();
      spy.mockRestore();
    });

    it("should watch one single folder provided as a param string", () => {
      const spy = jest.spyOn(playerLocalStorage, '_watchFolder');

      playerLocalStorage.watchFiles("test-bucket/test-folder/");

      expect(spy).toHaveBeenCalledWith("test-bucket/test-folder/");

      spy.mockReset();
      spy.mockRestore();
    });

    it("should start watching multiple folders", () => {
      const spy = jest.spyOn(playerLocalStorage, '_watchFolder');

      playerLocalStorage.watchFiles(["test-bucket/test-folder-1/", "test-bucket/test-folder-2/", "test-bucket/test-folder-3/"]);

      expect(spy).toHaveBeenCalledTimes(3);

      spy.mockReset();
      spy.mockRestore();
    });

    it("should only send watch of folders that aren't already being watched", () => {
      const spy = jest.spyOn(playerLocalStorage, '_watchFolder');

      playerLocalStorage.watchFiles(["test-bucket/test-folder-1/", "test-bucket/test-folder-2/", "test-bucket/test-folder-3/", "test-bucket/test-folder-4/"]);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("test-bucket/test-folder-4/");

      spy.mockReset();
      spy.mockRestore();
    });

    it("should call _setFileType()", () => {
      const spy = jest.spyOn(playerLocalStorage, '_setFileType');

      playerLocalStorage.watchFiles("test-bucket/test-filter-type.png", "image");

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("image");

      spy.mockReset();
      spy.mockRestore();
    });
  });

});