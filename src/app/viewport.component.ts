import {Component, Input, HostListener, Output, EventEmitter} from "@angular/core";
import {TileComponent} from "./tile.component";
import {Key, Direction} from "./constants";
import {PlayerService} from "./player/shared/player.service";
import {Location} from "./shared/location.model";
import {NPCService} from "./npc/shared/npc.service";
import {Player} from "./player/shared/player.model";
import {DungeonMap, Tile, DungeonObjectType, DungeonObject} from "./shared/map.model";
import {NPC} from "./npc/shared/npc.model";
import {StatusComponent} from "./status.component";
import {LogComponent} from "./log.component";

@Component({
  selector: 'sv-viewport',
  templateUrl: 'app/viewport.component.html',
  styleUrls: ['app/viewport.component.css'],
  directives: [TileComponent, StatusComponent, LogComponent]
})
export class ViewportComponent {

  @Input()
  map:DungeonMap;

  @Output()
  mapChanged:EventEmitter<any> = new EventEmitter();

  private messages:string[] = [];

  private player:Player;

  private npcs:NPC[];

  private objectiveReached:boolean = false;

  private jumpCounter = 0;
  private showPlatino = false;

  private initialised:boolean = false;

  constructor(private playerService:PlayerService, private npcService:NPCService) {

  }

  ngOnChanges(changes:{[propName:string]:SimpleChange}) {
    if (changes['map'] && changes['map'].currentValue && this.initialised) {
      this.resetNPCs();
      // TODO relocate player
      let corridorLocation = this.map.getCorridor();
      console.log(corridorLocation);
      this.playerService.setLocation(corridorLocation);
      this.player.location = corridorLocation;
    }
  }

  ngOnInit() {
    console.log("ngOnInit ViewportComponent")

    this.playerService.player$.subscribe(p => {
      this.player = p;
      this.handleNPCsMove();
      this.handleObjectCollsions();
    });

    this.npcService.npc$.subscribe(l => {
      this.npcs = l;
      if (this.checkPlayerNPCCollision()) {
        this.log("Arrrrgh! I am DEAD.");
        // TODO show game over
        //this.initGame();
      }
    });

    this.initGame();

    this.initialised = true;
  }

  initGame() {
    this.playerService.setStartLocation({x: 1, y: 1});
    // TODO add reset on service?
    this.resetNPCs();

  }

  resetNPCs() {
    this.npcService.reset();

    this.map.npcs.forEach(x => {
      this.npcService.addNpc(x);
    });

  }

  getMap():Tile[][] {
    let viewport = [];
    // deep copy
    this.map.floorLayer.forEach((row) => {
      let targetRow = [];
      row.forEach((originalTile) => {
        const copyTile = new Tile();
        copyTile.className = originalTile.className;
        targetRow.push(copyTile);
      });
      viewport.push(targetRow);
    });

    this.drawPlayer(viewport);
    this.drawNPCs(viewport, this.map);
    this.drawObjects(viewport, this.map);
    return viewport;
  }


  drawObjects(viewport:Tile[][], map:DungeonMap) {
    map.objects.forEach((object) => {
      // TODO map string from ObjectType enum
      viewport[object.location.y][object.location.x].object = object;
    });
  }

  drawPlayer(viewport:Tile[][]) {
    viewport[this.player.location.y][this.player.location.x].hasPlayer = true;
    if (this.showPlatino) {
      viewport[this.player.location.y - 1][this.player.location.x].hasPlatino = true;
    }
  }

  drawNPCs(viewport:Tile[][], map:DungeonMap) {
    map.npcs.forEach((object) => {
      // TODO map string from ObjectType enum
      viewport[object.location.y][object.location.x].npc = object;
    });
  }

  checkPlayerWallCollision(location:Location):boolean {
    const nextTile = this.map.floorLayer[location.y][location.x];
    let collision = nextTile.className.startsWith('w')
      || nextTile.className == 'a';
    if (collision) {
      this.log("You hit the wall!")
    }
    return collision;
  }

  checkPlayerNPCCollision(location:Location = this.player.location) {
    let collision:boolean = false;
    this.npcs.forEach((npc) => {
      if (npc.location.x === location.x
        && npc.location.y === location.y) {
        collision = true;
        this.log(npc.name + " bit you!")
        return;
      }
    });
    return collision;
  }

  checkNPCPlayerCollision(npcLocation:Location) {
    if (npcLocation.x === this.player.location.x
      && npcLocation.y === this.player.location.y) {
      return true;
    }
    return false;
  }

  isPlayerCloseToNPC(location:Location) {
    return this.getNPCCloseToPlayer() != null;
  }

  getNPCCloseToPlayer():NPC {
    if (this.npcs) {
      let selectedNPC:NPC = null;
      this.npcs.forEach((npc) => {
        if (npc.location.y == this.player.location.y && npc.getDistanceX(this.player.location) == 1) {
          selectedNPC = npc;
          return;
        } else if (npc.location.x == this.player.location.x && npc.getDistanceY(this.player.location) == 1) {
          selectedNPC = npc;
          return;
        }
      });
      return selectedNPC;
    }
    return null;
  }

  handleObjectCollsions() {
    this.map.objects.forEach((dungeonObject:DungeonObject) => {
      if (dungeonObject.location.x == this.player.location.x && dungeonObject.location.y == this.player.location.y) {
        switch (dungeonObject.type) {
          case DungeonObjectType.COIN:
            this.log("Ca-ching!");
            this.player.coins++;
            this.map.removeObject(dungeonObject);
            // TODO play coin sound!
            break;
          case DungeonObjectType.CORRIDOR:
            this.log("To infinity, and beyond!");
            this.mapChanged.emit(null);
            break;

          default:
            console.log("Unhandled object " + dungeonObject.type);
        }
      }
    });

    // Check if map objective has been reached
    var coinsLeft = false;
    this.map.objects.forEach((dungeonObject:DungeonObject) => {
      if (dungeonObject.type == DungeonObjectType.COIN) {
        coinsLeft = true;
      }
    });
    this.objectiveReached = !coinsLeft;
  }

  handleNPCsMove() {
    if (this.npcs) {
      this.npcs.forEach((npc) => {
        const nextTileLocation = this.npcService.nextLocation(npc);
        if (!this.checkOutsideOfMap(nextTileLocation)) {
          const nextTile = this.map.floorLayer[nextTileLocation.y][nextTileLocation.x];
          if (!nextTile || npc.checkCollision(nextTile)) {
            //this.log(npc.name + ": Uuuhh not that way");
            this.npcService.changeDirection(npc);
          }
        } else {

         // this.log(npc.name + ": It's the end of the world, as we know it (And I feel fine)");
          this.npcService.changeDirection(npc);
        }
        if (this.checkNPCPlayerCollision(this.npcService.nextLocation(npc))) {
          this.player.hp--;
          this.log("Ouch");
        } else {
          this.npcService.move(npc);
        }
      });

    }
  }

  checkOutsideOfMap(location:Location):boolean {
    return location.x == 0 || location.x == 10 || location.y == 0 || location.y == 8;
  }

  log(message:string) {
    this.messages.push(message);
  }

  removeNPC(npc:NPC) {
    this.map.removeNPC(npc);
    this.npcService.removeNPC(npc);
  }

  handlePlayerMove(direction:Direction) {
    console.log("handle player move");
    if (!this.checkPlayerWallCollision(this.playerService.nextLocation(direction))) {
      if (!this.checkPlayerNPCCollision(this.playerService.nextLocation(direction))) {
        console.log("player move");
        this.playerService.move(direction);
      } else {
        console.log("NONO");
        let npc:NPC = this.getNPCCloseToPlayer();
        npc.hp--;
        if (npc.isDead()) {
          this.log("you killed " + npc.name + "!");
          this.removeNPC(npc);
          this.playerService.move(direction);
        } else {
          this.handleNPCsMove();
        }
      }
    }

  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event:KeyboardEvent) {
    event.preventDefault();
    switch (event.keyCode) {
      case Key.ARROW_DOWN:
        this.handlePlayerMove(Direction.DOWN);
        break;
      case Key.ARROW_UP:
        this.handlePlayerMove(Direction.UP);
        break;
      case Key.ARROW_LEFT:
        this.handlePlayerMove(Direction.LEFT);
        break;
      case Key.ARROW_RIGHT:
        this.handlePlayerMove(Direction.RIGHT);
        break;
      case Key.SPACE:
        this.log("I would jump if someone would have added the animation...");
        this.jumpCounter++;
        if (this.jumpCounter == 100) {
          this.log("Ermagehrd! Platino!");
          this.showPlatino = !this.showPlatino;
          this.jumpCounter = 0;
        }
        break;
      // this.playerService.trigger();
      case Key.ENTER:
        this.log("Pushing enter probably does something");
        break;
      // this.playerService.??();
    }


  }
}
